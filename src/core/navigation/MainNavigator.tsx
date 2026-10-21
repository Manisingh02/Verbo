// Main Navigator - Drawer (camera swipe) + Bottom Tabs

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import type {
  MainDrawerParamList,
  MainTabParamList,
  HomeStackParamList,
  LearnStackParamList,
  CameraStackParamList,
  ReviewStackParamList,
  ProfileStackParamList,
} from '../../types/navigation.types';
import { colors } from '../../theme';

// Screens
import { DashboardScreen } from '../../screens/dashboard/DashboardScreen';
import { AlphabetFlashcardsScreen } from '../../screens/learning/AlphabetFlashcardsScreen';
import { FlashcardDeckScreen } from '../../screens/learning/FlashcardDeckScreen';
import { FlashcardsHomeScreen } from '../../screens/learning/FlashcardsHomeScreen';
import { FlashcardsScreen } from '../../screens/learning/FlashcardsScreen';
import { QuizScreen } from '../../screens/learning/QuizScreen';
import { CameraCaptureScreen } from '../../screens/camera/CameraCaptureScreen';
import { VocabConfirmationScreen } from '../../screens/camera/VocabConfirmationScreen';
import { ReviewQueueScreen } from '../../screens/review/ReviewQueueScreen';
import { ProgressOverviewScreen } from '../../screens/progress/ProgressOverviewScreen';

// Tab Icons (simple text for now - can replace with icons later)
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.tabIcon}>
      <Text style={[styles.tabIconText, focused && styles.tabIconTextFocused]}>
        {label}
      </Text>
    </View>
  );
}

// Stack Navigators for each tab
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Dashboard" component={DashboardScreen} />
      <HomeStack.Screen name="AlphabetFlashcards" component={AlphabetFlashcardsScreen} />
      <HomeStack.Screen name="FlashcardsHome" component={FlashcardsHomeScreen} />
      <HomeStack.Screen name="FlashcardDeck" component={FlashcardDeckScreen} />
      <HomeStack.Screen name="Flashcards" component={FlashcardsScreen} />
    </HomeStack.Navigator>
  );
}

const LearnStack = createNativeStackNavigator<LearnStackParamList>();
function LearnNavigator() {
  return (
    <LearnStack.Navigator screenOptions={{ headerShown: false }}>
      <LearnStack.Screen name="Quiz" component={QuizScreen} />
    </LearnStack.Navigator>
  );
}

const CameraStack = createNativeStackNavigator<CameraStackParamList>();
function CameraNavigator() {
  return (
    <CameraStack.Navigator screenOptions={{ headerShown: false }}>
      <CameraStack.Screen name="CameraCapture" component={CameraCaptureScreen} />
      <CameraStack.Screen name="VocabConfirmation" component={VocabConfirmationScreen} />
    </CameraStack.Navigator>
  );
}

const ReviewStack = createNativeStackNavigator<ReviewStackParamList>();
function ReviewNavigator() {
  return (
    <ReviewStack.Navigator screenOptions={{ headerShown: false }}>
      <ReviewStack.Screen name="ReviewQueue" component={ReviewQueueScreen} />
    </ReviewStack.Navigator>
  );
}

const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProgressOverview" component={ProgressOverviewScreen} />
    </ProfileStack.Navigator>
  );
}

// Bottom Tab Navigator
const Tab = createBottomTabNavigator<MainTabParamList>();
function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeNavigator}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon label="H" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="LearnTab"
        component={LearnNavigator}
        options={{
          tabBarLabel: 'Learn',
          tabBarIcon: ({ focused }) => <TabIcon label="L" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ReviewTab"
        component={ReviewNavigator}
        options={{
          tabBarLabel: 'Review',
          tabBarIcon: ({ focused }) => <TabIcon label="R" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon label="P" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

// Main Stack (Tabs + Camera) with custom swipe-to-camera gesture
const MainStack = createNativeStackNavigator<MainDrawerParamList>();

function TabsWithSwipe() {
  const navigation = useNavigation();

  return (
    <View style={styles.flex}>
      <TabNavigator />
      <PanGestureHandler
        onHandlerStateChange={(event) => {
          const { state, translationX } = event.nativeEvent;
          if (state === State.END && translationX > 60) {
            navigation.navigate('Camera' as never);
          }
        }}
        activeOffsetX={10}
        failOffsetY={[-20, 20]}
      >
        <View style={styles.edgeSwipeZone} />
      </PanGestureHandler>
    </View>
  );
}

export function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="Tabs" component={TabsWithSwipe} />
      <MainStack.Screen
        name="Camera"
        component={CameraNavigator}
        options={{ animation: 'slide_from_left' }}
      />
    </MainStack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.white,
    borderTopColor: colors.border,
    paddingBottom: 4,
    height: 60,
  },
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  tabIconText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabIconTextFocused: {
    color: colors.primary,
  },
  flex: {
    flex: 1,
  },
  edgeSwipeZone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 24,
    zIndex: 1000,
  },
});
