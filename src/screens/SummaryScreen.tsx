import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SummaryScreenProps {
  onRestart: () => void;
}

export const SummaryScreen: React.FC<SummaryScreenProps> = ({ onRestart }) => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Notice what{"\n"}shifted.</Text>
        <View style={styles.divider} />
        <Text style={styles.body}>Your mind has entered a stabilised state. The neural architecture has been optimized for clarity.</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.button} onPress={onRestart} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Begin Again</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.secondaryButton} onPress={onRestart}>
          <Text style={styles.secondaryButtonText}>SAVE SESSION</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 32,
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  content: {
    marginTop: 40,
  },
  title: {
    color: '#FFF',
    fontSize: 48,
    fontWeight: '300',
    lineHeight: 56,
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: '#00FF66',
    marginVertical: 24,
  },
  body: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    lineHeight: 24,
  },
  actions: {
    gap: 16,
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
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
