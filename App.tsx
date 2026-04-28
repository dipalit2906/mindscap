import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useMindscapeSession } from './src/hooks/useMindscapeSession';
import { BreathDetector } from './src/components/BreathDetector';
import { MindscapeRenderer } from './src/components/MindscapeRenderer';
import { PrivacyScreen } from './src/screens/PrivacyScreen';
import { CalibrationScreen } from './src/screens/CalibrationScreen';
import { ReadyScreen } from './src/screens/ReadyScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';

type AppStep = 'privacy' | 'calibration' | 'ready' | 'session' | 'summary';

export default function App() {
  const [step, setStep] = useState<AppStep>('privacy');
  const [isAudioLoading, setIsAudioLoading] = useState(true);
  
  const isCalibration = step === 'calibration';
  const { state, metrics, currentPhase, handleInference, isAwarenessMoment, reset } = useMindscapeSession(isCalibration);
  const rmsShared = useSharedValue(0);

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar hidden />
        
        {/* Background Audio/Mic Layer (Always Active when needed) */}
        {step !== 'privacy' && step !== 'summary' && (
          <BreathDetector key="permanent-ear" onInference={handleInference} rmsShared={rmsShared} />
        )}

        {step === 'privacy' && (
          <PrivacyScreen onContinue={() => setStep('calibration')} />
        )}

        {step === 'calibration' && (
          <CalibrationScreen 
            rmsShared={rmsShared}
            onComplete={() => setStep('ready')} 
          />
        )}

        {step === 'ready' && (
          <ReadyScreen onStart={() => setStep('session')} />
        )}

        {step === 'session' && (
          <View style={styles.sessionContainer}>
            <MindscapeRenderer 
              state={state} 
              rmsValue={rmsShared} 
              phase={currentPhase}
              isAwarenessMoment={isAwarenessMoment} 
              onAudioReady={() => setIsAudioLoading(false)}
            />

            {/* DASHBOARD HUD */}
            <View style={styles.hud}>
              <View style={styles.stateChip}>
                <Text style={styles.stateLabel}>{state.toUpperCase()}</Text>
              </View>
              
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{metrics.bpm.toFixed(1)}</Text>
                  <Text style={styles.metricName}>BPM</Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{metrics.variance.toFixed(2)}</Text>
                  <Text style={styles.metricName}>VAR</Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{metrics.ieRatio.toFixed(1)}</Text>
                  <Text style={styles.metricName}>I/E</Text>
                </View>
              </View>
            </View>
            
            <TouchableOpacity 
              style={styles.exitButton} 
              onPress={() => setStep('summary')}
            >
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          </View>
        )}

        {step === 'summary' && (
          <SummaryScreen onRestart={() => {
            reset();
            setStep('ready');
          }} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  sessionContainer: {
    flex: 1,
  },
  exitButton: {
    position: 'absolute',
    top: 60,
    right: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  hud: {
    position: 'absolute',
    bottom: 60,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  stateChip: {
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.2)',
    marginBottom: 24,
  },
  stateLabel: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 20,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '300',
    fontFamily: 'monospace',
  },
  metricName: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
