import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import {
  ObjectDetectionContext,
  useObjectDetection,
  useObjectDetectionModels,
} from '@infinitered/react-native-mlkit-object-detection';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PanGestureHandler, State } from 'react-native-gesture-handler';

import { Button } from '../../components/common';
import { translateImage } from '../../core/api';
import { normalizeDetectedObjects, normalizeRecognizedText } from '../../core/vision/mlKit';
import { colors, spacing, typography } from '../../theme';
import type { CameraStackParamList } from '../../types/navigation.types';
import type {
  TranslateImageResponse,
  VisionTranslationMode,
  VocabSuggestion,
} from '../../types/vision.types';

type CameraNavProp = NativeStackNavigationProp<CameraStackParamList, 'CameraCapture'>;

type SelectedImage = {
  uri: string;
  mimeType?: string;
};

const DEFAULT_TARGET_LANGUAGE = 'es';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong while translating the image.';
}

function buildSuggestionsFromResult(result: TranslateImageResponse): VocabSuggestion[] {
  if (result.mode === 'ocr') {
    return result.rawText
      .map((textNative, index) => {
        const textTarget = result.translatedText[index] || '';
        const type: VocabSuggestion['type'] = textNative.trim().includes(' ')
          ? 'phrase'
          : 'word';
        return {
          sourceIndex: index,
          textNative,
          textTarget,
          type,
          confidence: 1,
          source: 'camera' as const,
        };
      })
      .filter((item) => item.textNative.trim().length > 0 && item.textTarget.trim().length > 0);
  }

  return result.rawLabels
    .map((textNative, index) => ({
      sourceIndex: index,
      textNative,
      textTarget: result.translatedLabels[index] || '',
      type: 'objectLabel' as const,
      confidence: 1,
      source: 'camera' as const,
    }))
    .filter((item) => item.textNative.trim().length > 0 && item.textTarget.trim().length > 0);
}

export function CameraCaptureScreen() {
  const isExpoGo = Constants.executionEnvironment === 'storeClient';
  const defaultModelOptions = useMemo(
    () => ({
      shouldEnableClassification: true,
      shouldEnableMultipleObjects: true,
      detectorMode: 'singleImage' as const,
    }),
    []
  );
  const objectDetectionModels = useObjectDetectionModels({
    loadDefaultModel: !isExpoGo,
    defaultModelOptions,
  });

  return (
    <ObjectDetectionContext.Provider value={objectDetectionModels}>
      <CameraCaptureScreenContent />
    </ObjectDetectionContext.Provider>
  );
}

function CameraCaptureScreenContent() {
  const navigation = useNavigation<CameraNavProp>();
  const cameraRef = useRef<CameraView>(null);
  const objectDetector = useObjectDetection<any>('default');

  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<VisionTranslationMode>('ocr');
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<TranslateImageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = isCapturing || isSubmitting;
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  const handleClose = () => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate('Tabs' as never);
      return;
    }
    navigation.dispatch(DrawerActions.closeDrawer());
  };

  const resetResultState = () => {
    setError(null);
    setResult(null);
  };

  const handleModeChange = (nextMode: VisionTranslationMode) => {
    if (nextMode !== mode) {
      setMode(nextMode);
      resetResultState();
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current || isBusy) return;

    setIsCapturing(true);
    resetResultState();
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
      });

      if (photo?.uri) {
        setSelectedImage({
          uri: photo.uri,
          mimeType: 'image/jpeg',
        });
      }
    } catch (_error) {
      Alert.alert('Capture failed', 'We could not capture the photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handlePickImage = async () => {
    if (isBusy) return;

    resetResultState();
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to choose an image.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
    });

    if (pickerResult.canceled || !pickerResult.assets[0]) {
      return;
    }

    const asset = pickerResult.assets[0];
    setSelectedImage({
      uri: asset.uri,
      mimeType: asset.mimeType || 'image/jpeg',
    });
  };

  const handleClearImage = () => {
    setSelectedImage(null);
    resetResultState();
  };

  const handleTranslate = async () => {
    if (!selectedImage) {
      setError('Take a photo or choose one from your library before translating.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      if (isExpoGo) {
        throw new Error('ML Kit OCR and object detection require an Expo development build, not Expo Go.');
      }

      const response =
        mode === 'ocr'
          ? await (async () => {
              const recognized = await recognizeText(selectedImage.uri);
              const { rawText, regions } = normalizeRecognizedText(recognized);
              if (rawText.length === 0) {
                throw new Error('No readable text was found. Try a closer, sharper photo with good lighting.');
              }
              return translateImage({
                mode,
                targetLanguage: DEFAULT_TARGET_LANGUAGE,
                rawText,
                regions,
              });
            })()
          : await (async () => {
              if (!objectDetector) {
                throw new Error('Object detection model is still loading. Try again in a moment.');
              }

              const detections = await objectDetector.detectObjects(selectedImage.uri);
              const { objectCount, rawLabels, boxes } = normalizeDetectedObjects(detections);
              if (rawLabels.length === 0) {
                if (objectCount > 0) {
                  throw new Error(
                    'Objects were found, but they could not be classified. Try a clearer photo of a common everyday object.'
                  );
                }
                throw new Error(
                  'No object was detected. Try photographing a single everyday object like a bottle, chair, phone, or laptop.'
                );
              }
              return translateImage({
                mode,
                targetLanguage: DEFAULT_TARGET_LANGUAGE,
                rawLabels,
                boxes,
              });
            })();

      setResult(response);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.permissionText}>Loading camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centeredState}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionText}>
            Verbo needs camera access to translate text and recognize objects around you.
          </Text>
          <Button title="Grant Permission" onPress={requestPermission} fullWidth />
          <Button title="Go Back" onPress={handleClose} variant="ghost" fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  const hasResultItems =
    result?.mode === 'ocr'
      ? result.rawText.length > 0 || result.translatedText.length > 0
      : result?.rawLabels.length || result?.translatedLabels.length;
  const resultSuggestions = result ? buildSuggestionsFromResult(result) : [];

  const handleReviewFlashcards = () => {
    if (!result || resultSuggestions.length === 0) {
      Alert.alert('No flashcards', 'There are no translated results ready to save.');
      return;
    }

    navigation.navigate('VocabConfirmation', {
      visionResultId: result.visionResultId,
      suggestions: resultSuggestions,
    });
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.previewSection}>
          {selectedImage ? (
            <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
          ) : (
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          )}

          <View pointerEvents="box-none" style={styles.previewOverlay}>
            <View style={styles.header}>
              <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
                <Text style={styles.headerButtonText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>
                {mode === 'ocr' ? 'OCR Translation' : 'Object Translation'}
              </Text>
              <View style={styles.headerButton} />
            </View>

            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeButton, mode === 'ocr' && styles.modeButtonActive]}
                onPress={() => handleModeChange('ocr')}
              >
                <Text style={[styles.modeButtonText, mode === 'ocr' && styles.modeButtonTextActive]}>
                  OCR
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeButton, mode === 'object_detection' && styles.modeButtonActive]}
                onPress={() => handleModeChange('object_detection')}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    mode === 'object_detection' && styles.modeButtonTextActive,
                  ]}
                >
                  Objects
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.hintContainer}>
              <Text style={styles.hintText}>
                {selectedImage
                  ? 'Preview ready. Translate when you are happy with the image.'
                  : isExpoGo
                    ? 'ML Kit needs an Expo development build. Expo Go can preview the screen but cannot run OCR or object detection.'
                    : mode === 'ocr'
                      ? 'Capture or upload signs, menus, books, or labels.'
                      : 'Capture or upload everyday objects around you.'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsSection}>
          <View style={styles.actionRow}>
            <Button
              title={selectedImage ? 'Choose Another' : 'Upload Image'}
              onPress={selectedImage ? handleClearImage : handlePickImage}
              variant="outline"
              style={styles.flexButton}
              disabled={isBusy}
            />
            <Button
              title={selectedImage ? 'Translate Image' : 'Take Photo'}
              onPress={selectedImage ? handleTranslate : handleCapture}
              loading={selectedImage ? isSubmitting : isCapturing}
              style={styles.flexButton}
            />
          </View>

          {selectedImage ? (
            <Button
              title="Use Gallery Instead"
              onPress={handlePickImage}
              variant="ghost"
              disabled={isBusy}
              fullWidth
            />
          ) : null}

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Translation failed</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {result ? (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Translated Results</Text>
              <Text style={styles.resultsMeta}>
                {[result.modelVision, result.modelTranslation, result.targetLanguage.toUpperCase()].join(
                  ' -> '
                )}
              </Text>
              {result.warning ? <Text style={styles.warningText}>{result.warning}</Text> : null}

              <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.resultsContent}>
                {result.mode === 'ocr' ? (
                  result.rawText.map((item, index) => (
                    <View key={`${item}-${index}`} style={styles.resultRow}>
                      <Text style={styles.resultSource}>{item}</Text>
                      <Text style={styles.resultTranslated}>
                        {result.translatedText[index] || 'No translation returned'}
                      </Text>
                    </View>
                  ))
                ) : (
                  result.rawLabels.map((item, index) => (
                    <View key={`${item}-${index}`} style={styles.resultRow}>
                      <Text style={styles.resultSource}>{item}</Text>
                      <Text style={styles.resultTranslated}>
                        {result.translatedLabels[index] || 'No translation returned'}
                      </Text>
                    </View>
                  ))
                )}

                {!hasResultItems ? (
                  <Text style={styles.emptyResultText}>
                    No results came back from the image pipeline for this image.
                  </Text>
                ) : null}
              </ScrollView>

              {resultSuggestions.length > 0 ? (
                <Button
                  title="Review & Save Flashcards"
                  onPress={handleReviewFlashcards}
                  fullWidth
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      <PanGestureHandler
        onHandlerStateChange={(event) => {
          const { state, translationX } = event.nativeEvent;
          if (state === State.END && translationX < -60) {
            handleClose();
          }
        }}
        activeOffsetX={-10}
        failOffsetY={[-20, 20]}
      >
        <View style={styles.exitSwipeZone} />
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  previewSection: {
    flex: 1,
    backgroundColor: colors.black,
  },
  camera: {
    flex: 1,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: 24,
    color: colors.white,
  },
  headerTitle: {
    ...typography.h4,
    color: colors.white,
  },
  modeToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 22,
    padding: 4,
    marginTop: spacing.md,
  },
  modeButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 18,
  },
  modeButtonActive: {
    backgroundColor: colors.white,
  },
  modeButtonText: {
    ...typography.bodySemibold,
    color: colors.white,
  },
  modeButtonTextActive: {
    color: colors.black,
  },
  hintContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  hintText: {
    ...typography.body,
    color: colors.white,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  actionsSection: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flexButton: {
    flex: 1,
  },
  resultsCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    maxHeight: 260,
  },
  resultsTitle: {
    ...typography.h4,
    color: colors.text,
  },
  resultsMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  resultsScroll: {
    flexGrow: 0,
  },
  resultsContent: {
    gap: spacing.sm,
  },
  resultRow: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultSource: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  resultTranslated: {
    ...typography.body,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  emptyResultText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  warningText: {
    ...typography.body,
    color: colors.warning,
    marginBottom: spacing.md,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: spacing.lg,
  },
  errorTitle: {
    ...typography.bodySemibold,
    color: colors.error,
    marginBottom: spacing.xs,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  permissionContainer: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
  },
  permissionIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  permissionTitle: {
    ...typography.h2,
    textAlign: 'center',
    color: colors.text,
  },
  permissionText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  exitSwipeZone: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 24,
    zIndex: 1000,
  },
});
