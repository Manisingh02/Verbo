// Dashboard Screen - Main home screen

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../core/providers';
import { colors, spacing, typography } from '../../theme';
import type { MainTabParamList, HomeStackParamList } from '../../types/navigation.types';

type DashboardNavProp = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Dashboard'>,
  BottomTabNavigationProp<MainTabParamList>
>;

export function DashboardScreen() {
  const navigation = useNavigation<DashboardNavProp>();
  const { user, signOut } = useAuth();

  const openCamera = () => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate('Camera' as never);
      return;
    }
    navigation.dispatch(DrawerActions.openDrawer());
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back!</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
          <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>XP</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>1</Text>
            <Text style={styles.statLabel}>Level</Text>
          </View>
        </View>

        {/* Camera Hint */}
        <TouchableOpacity style={styles.cameraHint} onPress={openCamera}>
          <Text style={styles.cameraHintIcon}>📷</Text>
          <View style={styles.cameraHintText}>
            <Text style={styles.cameraHintTitle}>Learn from the world</Text>
            <Text style={styles.cameraHintSubtitle}>
              Swipe right or tap here to capture text or objects
            </Text>
          </View>
        </TouchableOpacity>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Continue Learning</Text>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('AlphabetFlashcards')}
        >
          <Text style={styles.actionIcon}>🔤</Text>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Alphabet Flashcards</Text>
            <Text style={styles.actionSubtitle}>Practice letters</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('FlashcardsHome')}
        >
          <Text style={styles.actionIcon}>📚</Text>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Flashcards</Text>
            <Text style={styles.actionSubtitle}>Review vocabulary</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => (navigation as any).navigate('LearnTab')}
        >
          <Text style={styles.actionIcon}>📝</Text>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Quiz</Text>
            <Text style={styles.actionSubtitle}>Test your knowledge</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => (navigation as any).navigate('ReviewTab')}
        >
          <Text style={styles.actionIcon}>🔄</Text>
          <View style={styles.actionContent}>
            <Text style={styles.actionTitle}>Review Queue</Text>
            <Text style={styles.actionSubtitle}>0 items due</Text>
          </View>
        </TouchableOpacity>

        {/* Roadmap Preview */}
        <Text style={styles.sectionTitle}>Your Roadmap</Text>
        <View style={styles.roadmapCard}>
          <View style={styles.roadmapItem}>
            <View style={[styles.roadmapDot, styles.roadmapDotCompleted]} />
            <Text style={styles.roadmapText}>Alphabet</Text>
          </View>
          <View style={styles.roadmapLine} />
          <View style={styles.roadmapItem}>
            <View style={[styles.roadmapDot, styles.roadmapDotActive]} />
            <Text style={styles.roadmapText}>Basic Words</Text>
          </View>
          <View style={styles.roadmapLine} />
          <View style={styles.roadmapItem}>
            <View style={styles.roadmapDot} />
            <Text style={[styles.roadmapText, styles.roadmapTextLocked]}>Phrases</Text>
          </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  greeting: {
    ...typography.h2,
  },
  email: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  signOutButton: {
    padding: spacing.sm,
  },
  signOutText: {
    ...typography.bodySmall,
    color: colors.error,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h2,
    color: colors.primary,
  },
  statLabel: {
    ...typography.caption,
  },
  cameraHint: {
    flexDirection: 'row',
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  cameraHintIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  cameraHintText: {
    flex: 1,
  },
  cameraHintTitle: {
    ...typography.bodySemibold,
    color: colors.white,
  },
  cameraHintSubtitle: {
    ...typography.bodySmall,
    color: colors.white,
    opacity: 0.9,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },
  actionCard: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  actionIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    ...typography.bodySemibold,
  },
  actionSubtitle: {
    ...typography.caption,
  },
  roadmapCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.lg,
  },
  roadmapItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roadmapDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gray300,
    marginRight: spacing.md,
  },
  roadmapDotCompleted: {
    backgroundColor: colors.success,
  },
  roadmapDotActive: {
    backgroundColor: colors.primary,
  },
  roadmapLine: {
    width: 2,
    height: 20,
    backgroundColor: colors.gray300,
    marginLeft: 7,
    marginVertical: 4,
  },
  roadmapText: {
    ...typography.body,
  },
  roadmapTextLocked: {
    color: colors.textTertiary,
  },
});
