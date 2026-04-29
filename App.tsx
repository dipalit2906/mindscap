import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, TouchableOpacity, Text, Pressable } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useMindscapeSession } from './src/hooks/useMindscapeSession';
import { BreathDetector } from './src/components/BreathDetector';
import { MindscapeRenderer } from './src/components/MindscapeRenderer';
import { PrivacyScreen } from './src/screens/PrivacyScreen';
import { CalibrationScreen } from './src/screens/CalibrationScreen';
import { ReadyScreen } from './src/screens/ReadyScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { MindscapeState } from './src/hooks/useMindscapeSession';

const STATE_COLORS: Record<MindscapeState, string> = {
  [MindscapeState.NARROWED]: '#FF7096', // Pink
  [MindscapeState.TRANSITION]: '#FFB347', // Orange
  [MindscapeState.EXPANDED]: '#00FF99', // Green
  [MindscapeState.STABILISED]: '#00CED1', // Teal
};

type AppStep = 'privacy' | 'calibration' | 'ready' | 'session' | 'summary';

export default function App() {
  const [step, setStep] = useState<AppStep>('privacy');
  const [isAudioLoading, setIsAudioLoading] = useState(true);
  const [sensingMode, setSensingMode] = useState<'mic' | 'touch'>('mic');

  const isCalibration = step === 'calibration';
  const { state, metrics, currentPhase, liveDepth, phaseRampMs, handleInference, manualTrigger, isAwarenessMoment, reset } = useMindscapeSession(isCalibration);
  const rmsShared = useSharedValue(0);

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar hidden />

        {/* Background Audio/Mic Layer (Only active in Mic mode) */}
        {step !== 'privacy' && step !== 'summary' && sensingMode === 'mic' && (
          <BreathDetector key="permanent-ear" onInference={handleInference} rmsShared={rmsShared} />
        )}

        {/* Global Renderer (Only active during session) */}
        {step === 'session' && (
          <MindscapeRenderer
            state={state}
            rmsValue={rmsShared}
            phase={currentPhase}
            phaseRampMs={phaseRampMs}
            liveDepth={liveDepth}
            isAwarenessMoment={isAwarenessMoment}
            onAudioReady={(ready) => setIsAudioLoading(!ready)}
            isMuted={step === 'calibration'}
          />
        )}

        {/* TOUCH OVERLAY LAYER */}
        {step === 'session' && sensingMode === 'touch' && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={() => {
              manualTrigger('Inhale');
              rmsShared.value = withTiming(0.15, { duration: 400 });
            }}
            onPressOut={() => {
              manualTrigger('Exhale');
              rmsShared.value = withTiming(0, { duration: 800 });
            }}
          />
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
          <ReadyScreen
            sensingMode={sensingMode}
            onModeChange={setSensingMode}
            onStart={() => {
              reset();
              setStep('session');
            }}
          />
        )}



        {step === 'session' && (
          <View style={styles.sessionContainer}>
            {isAudioLoading && (
              <View style={styles.loadingOverlay}>
                <Text style={styles.loadingText}>SYNCING SOUNDSCAPE...</Text>
              </View>
            )}

            {/* DASHBOARD HUD */}
            <View style={styles.hud}>
              <View style={[
                styles.stateChip,
                { backgroundColor: `${STATE_COLORS[state]}15`, borderColor: `${STATE_COLORS[state]}30` }
              ]}>
                <Text style={[styles.stateLabel, { color: STATE_COLORS[state] }]}>
                  {state.toUpperCase()}
                </Text>
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

              {/* Mode Toggle Button in Session */}
              <TouchableOpacity
                style={[
                  styles.modeToggle,
                  sensingMode === 'touch' && { borderColor: '#FFB347', backgroundColor: 'rgba(255,179,71,0.1)' }
                ]}
                onPress={() => setSensingMode(prev => prev === 'mic' ? 'touch' : 'mic')}
              >
                <Ionicons
                  name={sensingMode === 'mic' ? 'mic' : 'finger-print'}
                  size={14}
                  color={sensingMode === 'touch' ? '#FFB347' : 'rgba(255,255,255,0.6)'}
                />
                <Text style={[
                  styles.modeText,
                  sensingMode === 'touch' && { color: '#FFB347' }
                ]}>
                  {sensingMode === 'mic' ? 'MIC MODE' : 'TOUCH MODE'}
                </Text>
              </TouchableOpacity>
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
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
  },
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginLeft: 6,
  },
  stateLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
  readyContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleReady: {
    position: 'absolute',
    bottom: 120,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  modeTextLarge: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginLeft: 10,
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    letterSpacing: 4,
    fontWeight: '700',
  },
});
