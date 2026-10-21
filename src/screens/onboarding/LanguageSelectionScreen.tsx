// Language Selection Screen - Onboarding after signup

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '../../theme';
import type { Language } from '../../types/user.types';

// Hardcoded languages for skeleton - will be fetched from backend later
const LANGUAGES: Language[] = [
  { id: 'es', name: 'Spanish', isoCode: 'es' },
  { id: 'fr', name: 'French', isoCode: 'fr' },
  { id: 'de', name: 'German', isoCode: 'de' },
  { id: 'it', name: 'Italian', isoCode: 'it' },
  { id: 'pt', name: 'Portuguese', isoCode: 'pt' },
  { id: 'ja', name: 'Japanese', isoCode: 'ja' },
  { id: 'ko', name: 'Korean', isoCode: 'ko' },
  { id: 'zh', name: 'Chinese', isoCode: 'zh' },
  { id: 'ar', name: 'Arabic', isoCode: 'ar' },
  { id: 'hi', name: 'Hindi', isoCode: 'hi' },
];

export function LanguageSelectionScreen() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selectedLanguage) return;

    setLoading(true);
    // TODO: Call Cloud Function to set user's target language
    // For now, just simulate a delay
    setTimeout(() => {
      setLoading(false);
      // Navigation will happen automatically when user profile updates
    }, 1000);
  };

  const renderLanguage = ({ item }: { item: Language }) => {
    const isSelected = selectedLanguage === item.id;

    return (
      <TouchableOpacity
        style={[styles.languageItem, isSelected && styles.languageItemSelected]}
        onPress={() => setSelectedLanguage(item.id)}
      >
        <Text style={[styles.languageName, isSelected && styles.languageNameSelected]}>
          {item.name}
        </Text>
        {isSelected && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>What do you want to learn?</Text>
        <Text style={styles.subtitle}>Choose your target language</Text>

        <FlatList
          data={LANGUAGES}
          keyExtractor={(item) => item.id}
          renderItem={renderLanguage}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />

        <TouchableOpacity
          style={[
            styles.button,
            (!selectedLanguage || loading) && styles.buttonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selectedLanguage || loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Setting up...' : 'Continue'}
          </Text>
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  list: {
    paddingBottom: spacing.lg,
  },
  languageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  languageItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  languageName: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  languageNameSelected: {
    color: colors.primary,
  },
  checkmark: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typography.button,
    color: colors.textInverse,
  },
});
