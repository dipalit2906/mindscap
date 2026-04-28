import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

interface PrivacyScreenProps {
  onContinue: () => void;
}

export const PrivacyScreen: React.FC<PrivacyScreenProps> = ({ onContinue }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={32} color="#00FF66" />
        <Text style={styles.title}>Your Data{"\n"}Stays Yours</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <BlurView intensity={20} tint="dark" style={styles.blur}>
            <View style={styles.row}>
              <Ionicons name="phone-portrait-outline" size={24} color="#00FF66" />
              <View style={styles.textGroup}>
                <Text style={styles.cardTitle}>On-device data only</Text>
                <Text style={styles.cardBody}>Your mental landscape is processed locally. No external servers ever see your raw data.</Text>
              </View>
            </View>
          </BlurView>
        </View>

        <View style={styles.card}>
          <BlurView intensity={20} tint="dark" style={styles.blur}>
            <View style={styles.row}>
              <Ionicons name="mic-off-outline" size={24} color="#00FF66" />
              <View style={styles.textGroup}>
                <Text style={styles.cardTitle}>No audio stored</Text>
                <Text style={styles.cardBody}>Voice patterns are converted to math in real-time and immediately purged from memory.</Text>
              </View>
            </View>
          </BlurView>
        </View>

        <View style={styles.card}>
          <BlurView intensity={20} tint="dark" style={styles.blur}>
            <View style={styles.row}>
              <Ionicons name="lock-closed-outline" size={24} color="#00FF66" />
              <View style={styles.textGroup}>
                <Text style={styles.cardTitle}>Local encryption</Text>
                <Text style={styles.cardBody}>Your session stats are AES-256 grade encrypted and tied solely to your device key.</Text>
              </View>
            </View>
          </BlurView>
        </View>
      </View>

      <TouchableOpacity style={styles.button} onPress={onContinue} activeOpacity={0.8}>
        <Text style={styles.buttonText}>I Understand</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 24,
  },
  header: {
    marginTop: 80,
    marginBottom: 40,
    alignItems: 'center',
  },
  title: {
    color: '#FFF',
    fontSize: 42,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 48,
  },
  content: {
    flex: 1,
    gap: 16,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  blur: {
    padding: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  textGroup: {
    flex: 1,
  },
  cardTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardBody: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    backgroundColor: '#00FF66',
    paddingVertical: 18,
    borderRadius: 40,
    alignItems: 'center',
    marginBottom: 60,
  },
  buttonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
});
