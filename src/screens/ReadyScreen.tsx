import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

interface ReadyScreenProps {
  onStart: () => void;
}

export const ReadyScreen: React.FC<ReadyScreenProps> = ({ onStart }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.stateLabel}>H-1 STATE CONFIRMED</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Ready?</Text>
        <Text style={styles.subtitle}>Session stays local on your device.</Text>
        
        <View style={styles.modeContainer}>
          <TouchableOpacity style={styles.modeCard}>
            <BlurView intensity={20} tint="dark" style={styles.modeBlur}>
              <Ionicons name="mic-outline" size={24} color="#00FF66" />
              <Text style={styles.modeText}>MIC</Text>
            </BlurView>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.modeCard, styles.inactiveMode]}>
            <BlurView intensity={10} tint="dark" style={styles.modeBlur}>
              <Ionicons name="hand-right-outline" size={24} color="rgba(255,255,255,0.3)" />
              <Text style={[styles.modeText, styles.inactiveText]}>TOUCH</Text>
            </BlurView>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.button} onPress={onStart} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Enter Session</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: {
    alignItems: 'center',
  },
  stateLabel: {
    color: '#00FF66',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  content: {
    alignItems: 'center',
  },
  title: {
    color: '#FFF',
    fontSize: 56,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginBottom: 48,
  },
  modeContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  modeCard: {
    width: 100,
    height: 100,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
  },
  inactiveMode: {
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeBlur: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  modeText: {
    color: '#00FF66',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  inactiveText: {
    color: 'rgba(255,255,255,0.3)',
  },
  button: {
    backgroundColor: '#00FF66',
    paddingVertical: 18,
    borderRadius: 40,
    alignItems: 'center',
  },
  buttonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
});
