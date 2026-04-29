import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Canvas, Circle, Paint, Blur, Group, Path, Skia } from '@shopify/react-native-skia';
import { useSharedValue, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';

interface CalibrationScreenProps {
  rmsShared: { value: number };
  onComplete: () => void;
}

export const CalibrationScreen: React.FC<CalibrationScreenProps> = ({ rmsShared, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [displayRms, setDisplayRms] = useState(0);
  const ringRotate = useSharedValue(0);

  useEffect(() => {
    ringRotate.value = withRepeat(withTiming(360, { duration: 4000, easing: Easing.linear }), -1);

    const interval = setInterval(() => {
      // Safely update the display RMS from the shared value
      setDisplayRms(rmsShared.value);

      setProgress(p => {
        if (p >= 1) {
          clearInterval(interval);
          setTimeout(onComplete, 500);
          return 1;
        }
        return p + 0.01;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.status}>SYSTEM DIAGNOSTIC</Text>
        <Text style={styles.rateLabel}>ENVIRONMENT NOISE FLOOR</Text>
      </View>

      <View style={styles.center}>
        <Canvas style={styles.canvas}>
          <Group origin={{ x: 150, y: 150 }}>
            <Circle cx={150} cy={150} r={100} color="rgba(0, 255, 102, 0.05)" />
            <Circle cx={150} cy={150} r={100} color="#00FF66" style="stroke" strokeWidth={1}>
              <Blur blur={5} />
            </Circle>
          </Group>
        </Canvas>
        <View style={styles.rateContainer}>
          <Text style={styles.rateValue}>{(displayRms * 1000).toFixed(2)}</Text>
          <Text style={styles.unit}>ENV RATE</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.instruction}>Sending your neural rhythm...</Text>
        <Text style={styles.subInstruction}>Please remain still and maintain a steady breath. We are optimizing your sensory landscape for depth.</Text>

        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: {
    alignItems: 'center',
  },
  status: {
    color: '#00FF66',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  rateLabel: {
    color: '#FFF',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 8,
    opacity: 0.5,
  },
  center: {
    width: 300,
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvas: {
    width: 300,
    height: 300,
    position: 'absolute',
  },
  rateContainer: {
    alignItems: 'center',
  },
  rateValue: {
    color: '#FFF',
    fontSize: 64,
    fontWeight: '300',
    fontFamily: 'monospace',
  },
  unit: {
    color: '#00FF66',
    fontSize: 10,
    letterSpacing: 2,
    marginTop: -4,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  instruction: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  subInstruction: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 32,
  },
  progressBar: {
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00FF66',
  },
});
