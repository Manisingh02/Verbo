// Auth Navigator - Login, SignUp, ForgotPassword screens

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation.types';

// Screens
import { LoginScreen } from '../../screens/auth/LoginScreen';
import { SignUpScreen } from '../../screens/auth/SignUpScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}
