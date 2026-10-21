// Onboarding Navigator - Language selection after signup

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from '../../types/navigation.types';

// Screens
import { LanguageSelectionScreen } from '../../screens/onboarding/LanguageSelectionScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="LanguageSelection" component={LanguageSelectionScreen} />
    </Stack.Navigator>
  );
}
