// Vocab Confirmation Screen - Confirm vocab suggestions from camera

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { colors, spacing, typography } from '../../theme';
import { confirmVisionFlashcards } from '../../core/api';
import type { CameraStackParamList } from '../../types/navigation.types';
import type { VocabSuggestion } from '../../types/vision.types';

type Props = NativeStackScreenProps<CameraStackParamList, 'VocabConfirmation'>;

export function VocabConfirmationScreen() {
  const navigation = useNavigation();
  const route = useRoute<Props['route']>();

  const { visionResultId, suggestions } = route.params;
  const [editableSuggestions, setEditableSuggestions] = useState<VocabSuggestion[]>(suggestions);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const updateSuggestion = (
    index: number,
    field: 'textNative' | 'textTarget',
    value: string
  ) => {
    setEditableSuggestions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  };

  const handleConfirm = async () => {
    if (selectedIds.size === 0) {
      Alert.alert('Select flashcards', 'Please select at least one result to save.');
      return;
    }

    const selectedSuggestions = editableSuggestions
      .filter((_, index) => selectedIds.has(index))
      .map((item) => ({
        ...item,
        textNative: item.textNative.trim(),
        textTarget: item.textTarget.trim(),
      }))
      .filter((item) => item.textNative.length > 0 && item.textTarget.length > 0);

    if (selectedSuggestions.length === 0) {
      Alert.alert('Missing text', 'Selected flashcards need text on both sides.');
      return;
    }

    setSaving(true);
    try {
      const result = await confirmVisionFlashcards({
        visionResultId,
        suggestions: selectedSuggestions,
      });
      setSaving(false);
      Alert.alert(
        'Flashcards saved',
        `Saved ${result.savedCount} flashcard${result.savedCount === 1 ? '' : 's'} to your camera deck.`,
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error) {
      setSaving(false);
      Alert.alert(
        'Save failed',
        error instanceof Error ? error.message : 'Could not save flashcards.'
      );
    }
  };

  const handleSkip = () => {
    navigation.goBack();
  };

  const renderSuggestion = ({ item, index }: { item: VocabSuggestion; index: number }) => {
    const isSelected = selectedIds.has(index);
    const confidencePercent = Math.round(item.confidence * 100);

    return (
      <View style={[styles.suggestionCard, isSelected && styles.suggestionCardSelected]}>
        <View style={styles.suggestionContent}>
          <Text style={styles.inputLabel}>Flashcard Front</Text>
          <TextInput
            value={item.textTarget}
            onChangeText={(value) => updateSuggestion(index, 'textTarget', value)}
            style={styles.editInput}
            multiline
          />
          <Text style={styles.inputLabel}>Flashcard Back</Text>
          <TextInput
            value={item.textNative}
            onChangeText={(value) => updateSuggestion(index, 'textNative', value)}
            style={styles.editInput}
            multiline
          />
          <View style={styles.metaRow}>
            <Text style={styles.typeTag}>{item.type}</Text>
            <Text style={styles.confidence}>{confidencePercent}% confident</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.checkbox, isSelected && styles.checkboxSelected]}
          onPress={() => toggleSelection(index)}
        >
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleSkip}>
          <Text style={styles.headerButton}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Found {suggestions.length} results</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsText}>
          Select and edit the results you want to save as flashcards
        </Text>
      </View>

      {/* Suggestions List */}
      <FlatList
        data={editableSuggestions}
        keyExtractor={(_, index) => index.toString()}
        renderItem={renderSuggestion}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />

      {/* Action Buttons */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[styles.confirmButton, saving && styles.buttonDisabled]}
          onPress={handleConfirm}
          disabled={saving}
        >
          <Text style={styles.confirmButtonText}>
            {saving
              ? 'Saving...'
              : `Save ${selectedIds.size} flashcard${selectedIds.size !== 1 ? 's' : ''}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    ...typography.body,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.h4,
  },
  headerSpacer: {
    width: 50,
  },
  instructions: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.backgroundSecondary,
  },
  instructionsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  list: {
    padding: spacing.lg,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  suggestionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#F5F3FF',
  },
  suggestionContent: {
    flex: 1,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  editInput: {
    ...typography.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.backgroundSecondary,
  },
  targetText: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  nativeText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeTag: {
    ...typography.caption,
    backgroundColor: colors.gray100,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  confidence: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checkmark: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  actionContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  skipButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  skipButtonText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
