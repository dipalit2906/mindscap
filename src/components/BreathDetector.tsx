import React, { useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useAudioRecorder, RecordingConfig, AudioAnalysis, AudioStudioModule } from '@siteed/expo-audio-studio';
import { useInhaleExhaleDetector } from '../hooks/useInhaleExhaleDetector';
import { SharedValue } from 'react-native-reanimated';

interface BreathDetectorProps {
  onPhaseChange: (phase: 'Inhale' | 'Exhale' | 'Silence', duration: number, depth: number) => void;
  onCalibratingChange?: (isCalibrating: boolean) => void;
  rmsShared: SharedValue<number>;
}

export const BreathDetector: React.FC<BreathDetectorProps> = ({ onPhaseChange, onCalibratingChange, rmsShared }) => {
  const { startRecording, stopRecording, isRecording, prepareRecording } = useAudioRecorder();

  // Keep a stable ref to the callback to prevent effect re-runs
  const onPhaseChangeRef = useRef(onPhaseChange);
  useEffect(() => {
    onPhaseChangeRef.current = onPhaseChange;
  }, [onPhaseChange]);

  const { processFrame, currentPhase, depth, isCalibrating } = useInhaleExhaleDetector({
    onPhaseChange: (p, dur, d) => onPhaseChangeRef.current(p, dur, d),
    noiseFloor: 0.003,
  });

  useEffect(() => {
    onCalibratingChange?.(isCalibrating);
  }, [isCalibrating, onCalibratingChange]);

  const handleAudioAnalysis = useCallback(async (analysis: AudioAnalysis) => {
    if (!analysis.dataPoints || analysis.dataPoints.length === 0) return;
    const lastPoint = analysis.dataPoints[analysis.dataPoints.length - 1];
    if (!lastPoint.features) return;

    const { rms = 0, zcr = 0, spectralCentroid = 0 } = lastPoint.features;
    rmsShared.value = rms;
    processFrame(rms, zcr, spectralCentroid);
  }, [processFrame, rmsShared]);

  useEffect(() => {
    let isMounted = true;

    const config: RecordingConfig = {
      sampleRate: 44100,
      channels: 1,
      encoding: 'pcm_16bit',
      segmentDurationMs: 100,
      enableProcessing: true,
      onAudioAnalysis: handleAudioAnalysis,
      features: { rms: true, zcr: true, spectralCentroid: true },
    };

    const setup = async () => {
      try {
        console.log('[MIC] Requesting permissions...');
        const perm = await AudioStudioModule.requestPermissionsAsync();
        if (!perm.granted || !isMounted) return;

        console.log('[MIC] Preparing...');
        await prepareRecording(config);
        
        console.log('[MIC] Starting...');
        await startRecording(config);
        console.log('[MIC] Live and stable.');
      } catch (err: any) {
        console.error('[MIC] Failed to start:', err.message);
      }
    };

    setup();

    return () => {
      isMounted = false;
      console.log('[MIC] Stopping...');
      stopRecording();
    };
    // CRITICAL: Empty dependency array ensures the mic NEVER restarts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugText}>Mic: {isRecording ? '🟢 STABLE' : '🔴 OFF'}</Text>
      <Text style={styles.debugText}>Phase: {currentPhase.toUpperCase()}</Text>
      <Text style={styles.debugText}>Depth: {(depth * 100).toFixed(0)}%</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  debugPanel: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 8,
    zIndex: 1000,
  },
  debugText: {
    color: '#00ff00',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
