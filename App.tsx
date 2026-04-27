import React, { useState, useCallback } from 'react';
import { StyleSheet, View, StatusBar, Text } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useBreathingEngine } from './src/hooks/useBreathingEngine';
import { BreathDetector } from './src/components/BreathDetector';
import { MindscapeRenderer } from './src/components/MindscapeRenderer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  const { state, metrics, onBreathEvent } = useBreathingEngine();
  const [currentPhase, setCurrentPhase] = useState<'Inhale' | 'Exhale' | 'Silence'>('Silence');
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [isAudioLoading, setIsAudioLoading] = useState(true);

  // Live RMS — written by BreathDetector every 100ms, read by MindscapeRenderer on UI thread
  // SharedValue means ZERO React re-renders for the animation
  const rmsShared = useSharedValue(0);

  const handlePhaseChange = useCallback((
    phase: 'Inhale' | 'Exhale' | 'Silence',
    duration: number,
    depth: number
  ) => {
    setCurrentPhase(phase);
    onBreathEvent(phase, duration, depth);
  }, [onBreathEvent]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <StatusBar hidden />

        {/* Visual & Audio Engine — rmsShared drives ring animation on UI thread */}
        <MindscapeRenderer
          state={state}
          rmsValue={rmsShared}
          phase={currentPhase}
          onAudioReady={() => setIsAudioLoading(false)}
        />

        {/* Microphone & Phase Detection */}
        <BreathDetector
          onPhaseChange={handlePhaseChange}
          onCalibratingChange={setIsCalibrating}
          rmsShared={rmsShared}
        />

        {/* Calibration & Loading Instruction Overlay */}
        {(isCalibrating || isAudioLoading) && (
          <View style={styles.calibrationOverlay}>
            <Text style={styles.calibrationText}>
              {isAudioLoading ? 'LOADING SOUNDSCAPE' : 'CALIBRATING ENVIRONMENT'}
            </Text>
            <Text style={styles.calibrationSubText}>
              {isAudioLoading ? 'Preparing high-fidelity audio...' : 'Please remain still and quiet...'}
            </Text>
          </View>
        )}

        {/* HUD */}
        <View style={styles.hud}>
          <Text style={styles.stateText}>{state.toUpperCase()}</Text>
          <View style={styles.metricsRow}>
            <Text style={styles.metricText}>{Math.round(metrics.bpm)} BPM</Text>
            <Text style={styles.metricDivider}>|</Text>
            <Text style={styles.metricText}>I:E {metrics.ieRatio > 0 ? (1 / metrics.ieRatio).toFixed(1) : '--'}</Text>
            <Text style={styles.metricDivider}>|</Text>
            <Text style={styles.metricText}>VAR {metrics.variance.toFixed(2)}s</Text>
          </View>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  hud: {
    position: 'absolute',
    bottom: 50,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  stateText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '300',
    letterSpacing: 8,
    marginBottom: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    opacity: 0.5,
  },
  metricText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  metricDivider: { color: '#fff', fontSize: 10, opacity: 0.3 },
  calibrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 5, 8, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  calibrationText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '300',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 10,
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  calibrationSubText: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.5,
    letterSpacing: 1,
    textAlign: 'center',
  },
});
