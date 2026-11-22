import { StatusBar } from 'expo-status-bar'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { useState } from 'react'

import app from '../app.json'
import { colors } from './theme'

export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const c = colors[scheme]
  const [taps, setTaps] = useState(0)
  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
          {app.expo.name}
        </Text>
        <Text style={[styles.body, { color: c.muted }]}>{app.expo.description}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Say hello"
          onPress={() => setTaps((n) => n + 1)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 }
          ]}
        >
          <Text style={styles.buttonText}>{taps ? `Hello ×${taps}` : 'Say hello'}</Text>
        </Pressable>
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 24 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start'
  },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '600' }
})
