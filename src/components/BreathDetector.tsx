import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Platform, PermissionsAndroid } from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import { SharedValue } from 'react-native-reanimated';
import { base64ToFloat32, calculateRMS, calculateZCR, calculateCentroid } from '../utils/dsp';

interface BreathDetectorProps {
  onInference: (rms: number, zcr: number, centroid: number, waveform?: Float32Array) => void;
  rmsShared: SharedValue<number>;
}

const WINDOW_SIZE = 15600; // Client requirement: 15600 samples (~0.97s)

export const BreathDetector: React.FC<BreathDetectorProps> = ({ onInference, rmsShared }) => {
  const isRecording = React.useRef(false);
  const slidingWindow = useRef<Float32Array>(new Float32Array(WINDOW_SIZE));
  const [active, setActive] = React.useState(false);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'Mindscape needs access to your mic to detect breathing.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const onInferenceRef = useRef(onInference);
  const rmsSharedRef = useRef(rmsShared);
  
  useEffect(() => {
    onInferenceRef.current = onInference;
    rmsSharedRef.current = rmsShared;
  }, [onInference, rmsShared]);

  useEffect(() => {
    let isMounted = true;

    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6,
      bufferSize: 1024,
    };

    const setup = async () => {
      const hasPermission = await requestPermissions();
      if (!hasPermission || !isMounted) return;

      console.log('[STREAM] Initializing raw PCM ear...');
      LiveAudioStream.init(options);

      LiveAudioStream.on('data', (data: string) => {
        if (!isMounted) return;

        const samples = base64ToFloat32(data);
        
        const newWindow = new Float32Array(WINDOW_SIZE);
        newWindow.set(slidingWindow.current.subarray(samples.length));
        newWindow.set(samples, WINDOW_SIZE - samples.length);
        slidingWindow.current = newWindow;

        const rms = calculateRMS(samples);
        const zcr = calculateZCR(samples);
        const centroid = calculateCentroid(samples);
        
        // Use the Ref for shared value - reduced smoothing for faster "live" feel
        rmsSharedRef.current.value = (rmsSharedRef.current.value * 0.4) + (rms * 0.6);

        // Use the Ref for inference to avoid dependency restart
        onInferenceRef.current(rms, zcr, centroid, new Float32Array(slidingWindow.current));
      });

      console.log('[STREAM] Starting...');
      LiveAudioStream.start();
      isRecording.current = true;
      setActive(true);
    };

    setup();

    return () => {
      isMounted = false;
      console.log('[STREAM] Stopping...');
      LiveAudioStream.stop();
      isRecording.current = false;
      setActive(false);
    };
  }, []); // NO DEPENDENCIES = STABLE FOREVER

  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugText}>PCM Ear: {active ? '🟢 16kHz' : '🔴 OFF'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  debugPanel: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  debugText: {
    color: '#00FF00',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
