// Progress Overview Screen

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../core/providers';
import { colors, spacing, typography } from '../../theme';

// Mock progress data
const MOCK_STATS = {
  totalXp: 1250,
  streak: 7,
  wordsLearned: 45,
  quizzesTaken: 12,
  accuracy: 78,
  timeSpent: '4h 32m',
};

const MOCK_LEVELS = [
  { id: '1', name: 'Alphabet', progress: 100, status: 'completed' },
  { id: '2', name: 'Basic Words', progress: 65, status: 'in_progress' },
  { id: '3', name: 'Common Phrases', progress: 0, status: 'locked' },
];

export function ProgressOverviewScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Progress</Text>
        </View>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.email}</Text>
            <Text style={styles.profileLevel}>Level 2 Learner</Text>
          </View>
        </View>

        {/* Main Stats */}
        <View style={styles.mainStats}>
          <View style={styles.mainStatCard}>
            <Text style={styles.mainStatValue}>{MOCK_STATS.totalXp}</Text>
            <Text style={styles.mainStatLabel}>Total XP</Text>
          </View>
          <View style={styles.mainStatCard}>
            <Text style={styles.mainStatValue}>{MOCK_STATS.streak}</Text>
            <Text style={styles.mainStatLabel}>Day Streak</Text>
          </View>
        </View>

        {/* Detailed Stats */}
        <Text style={styles.sectionTitle}>Statistics</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statItemValue}>{MOCK_STATS.wordsLearned}</Text>
            <Text style={styles.statItemLabel}>Words Learned</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statItemValue}>{MOCK_STATS.quizzesTaken}</Text>
            <Text style={styles.statItemLabel}>Quizzes Taken</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statItemValue}>{MOCK_STATS.accuracy}%</Text>
            <Text style={styles.statItemLabel}>Accuracy</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statItemValue}>{MOCK_STATS.timeSpent}</Text>
            <Text style={styles.statItemLabel}>Time Spent</Text>
          </View>
        </View>

        {/* Level Progress */}
        <Text style={styles.sectionTitle}>Level Progress</Text>
        {MOCK_LEVELS.map((level) => (
          <View key={level.id} style={styles.levelCard}>
            <View style={styles.levelHeader}>
              <Text style={styles.levelName}>{level.name}</Text>
              <Text
                style={[
                  styles.levelStatus,
                  level.status === 'completed' && styles.levelStatusCompleted,
                  level.status === 'locked' && styles.levelStatusLocked,
                ]}
              >
                {level.status === 'completed'
                  ? 'Completed'
                  : level.status === 'locked'
                  ? 'Locked'
                  : `${level.progress}%`}
              </Text>
            </View>
            <View style={styles.levelProgressBar}>
              <View
                style={[
                  styles.levelProgressFill,
                  { width: `${level.progress}%` },
                  level.status === 'completed' && styles.levelProgressCompleted,
                ]}
              />
            </View>
          </View>
        ))}

        {/* Settings / Sign Out */}
        <View style={styles.settingsSection}>
          <TouchableOpacity style={styles.settingsButton} onPress={signOut}>
            <Text style={styles.settingsButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.h2,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    ...typography.h2,
    color: colors.textInverse,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    ...typography.bodySemibold,
    marginBottom: spacing.xs,
  },
  profileLevel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  mainStats: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  mainStatCard: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
  },
  mainStatValue: {
    ...typography.h1,
    color: colors.textInverse,
  },
  mainStatLabel: {
    ...typography.bodySmall,
    color: colors.textInverse,
    opacity: 0.9,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statItem: {
    width: '47%',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
  },
  statItemValue: {
    ...typography.h3,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  statItemLabel: {
    ...typography.caption,
  },
  levelCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  levelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  levelName: {
    ...typography.bodySemibold,
  },
  levelStatus: {
    ...typography.caption,
    color: colors.primary,
  },
  levelStatusCompleted: {
    color: colors.success,
  },
  levelStatusLocked: {
    color: colors.textTertiary,
  },
  levelProgressBar: {
    height: 8,
    backgroundColor: colors.gray200,
    borderRadius: 4,
    overflow: 'hidden',
  },
  levelProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  levelProgressCompleted: {
    backgroundColor: colors.success,
  },
  settingsSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingsButton: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  settingsButtonText: {
    ...typography.button,
    color: colors.error,
  },
});
