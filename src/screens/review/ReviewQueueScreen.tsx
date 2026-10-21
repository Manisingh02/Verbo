// Review Queue Screen

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '../../theme';
import type { ReviewQueueItem } from '../../types/vocab.types';
import { getReviewQueue } from '../../core/api';

// Mock review items for skeleton
const MOCK_REVIEW_ITEMS: ReviewQueueItem[] = [
  {
    vocabId: '1',
    dueAt: new Date(),
    priority: 1,
    updatedAt: new Date(),
    vocab: {
      id: '1',
      languageId: 'es',
      type: 'word',
      textNative: 'Hello',
      textTarget: 'Hola',
      source: 'preset_plan',
      createdAt: new Date(),
    },
  },
  {
    vocabId: '2',
    dueAt: new Date(),
    priority: 2,
    updatedAt: new Date(),
    vocab: {
      id: '2',
      languageId: 'es',
      type: 'word',
      textNative: 'Thank you',
      textTarget: 'Gracias',
      source: 'preset_plan',
      createdAt: new Date(),
    },
  },
  {
    vocabId: '3',
    dueAt: new Date(Date.now() + 86400000), // Tomorrow
    priority: 3,
    updatedAt: new Date(),
    vocab: {
      id: '3',
      languageId: 'es',
      type: 'phrase',
      textNative: 'Good morning',
      textTarget: 'Buenos días',
      source: 'camera',
      createdAt: new Date(),
    },
  },
];

function getDueText(dueAt: Date): string {
  const now = new Date();
  const diffMs = dueAt.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs <= 0) return 'Due now';
  if (diffHours < 24) return `Due in ${diffHours}h`;
  return `Due in ${diffDays}d`;
}

export function ReviewQueueScreen() {
  const [reviewItems, setReviewItems] = useState(MOCK_REVIEW_ITEMS);
  const [usingMock, setUsingMock] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const data = await getReviewQueue();
        if (!isMounted) return;
        if (data.length > 0) {
          setReviewItems(data);
          setUsingMock(false);
        } else {
          setReviewItems(MOCK_REVIEW_ITEMS);
          setUsingMock(true);
        }
      } catch (error) {
        if (!isMounted) return;
        setReviewItems(MOCK_REVIEW_ITEMS);
        setUsingMock(true);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const dueNow = reviewItems.filter(
    (item) => item.dueAt.getTime() <= Date.now()
  );
  const upcoming = reviewItems.filter(
    (item) => item.dueAt.getTime() > Date.now()
  );

  const renderReviewItem = ({ item }: { item: ReviewQueueItem }) => {
    const isDue = item.dueAt.getTime() <= Date.now();

    return (
      <TouchableOpacity style={styles.reviewCard}>
        <View style={styles.reviewContent}>
          <Text style={styles.targetText}>{item.vocab?.textTarget}</Text>
          <Text style={styles.nativeText}>{item.vocab?.textNative}</Text>
        </View>
        <View style={styles.reviewMeta}>
          <Text style={[styles.dueText, isDue && styles.dueTextNow]}>
            {getDueText(item.dueAt)}
          </Text>
          <Text style={styles.sourceTag}>{item.vocab?.source}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Review Queue</Text>
      </View>

      {usingMock && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Using sample data until content is uploaded.
          </Text>
        </View>
      )}

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dueNow.length}</Text>
          <Text style={styles.statLabel}>Due Now</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{upcoming.length}</Text>
          <Text style={styles.statLabel}>Upcoming</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{reviewItems.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* Start Review Button */}
      {dueNow.length > 0 && (
        <TouchableOpacity style={styles.startButton}>
          <Text style={styles.startButtonText}>
            Start Review ({dueNow.length} items)
          </Text>
        </TouchableOpacity>
      )}

      {/* Review List */}
      <FlatList
        data={reviewItems}
        keyExtractor={(item) => item.vocabId}
        renderItem={renderReviewItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎉</Text>
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>
              No items to review right now. Keep learning!
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
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
    ...typography.h3,
    color: colors.primary,
  },
  statLabel: {
    ...typography.caption,
  },
  startButton: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  startButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewContent: {
    flex: 1,
  },
  targetText: {
    ...typography.bodySemibold,
  },
  nativeText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  reviewMeta: {
    alignItems: 'flex-end',
  },
  dueText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  dueTextNow: {
    color: colors.primary,
    fontWeight: '600',
  },
  sourceTag: {
    ...typography.caption,
    fontSize: 10,
    backgroundColor: colors.gray100,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
