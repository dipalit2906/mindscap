import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Canvas, Circle, Group, BlurMask } from '@shopify/react-native-skia';
import {
  useSharedValue,
  withTiming,
  useDerivedValue,
  SharedValue,
} from 'react-native-reanimated';
import { BreathingState } from '../hooks/useBreathingEngine';
import { AudioContext, BiquadFilterNode } from 'react-native-audio-api';
import { Asset } from 'expo-asset';

const AUDIO_ASSETS = {
  [BreathingState.NARROWED]:   require('../../assets/audio/narrowed_texture.mp3'),
  [BreathingState.TRANSITION]: require('../../assets/audio/transition_texture.mp3'),
  [BreathingState.EXPANDED]:   require('../../assets/audio/expanded_base.mp3'),
  [BreathingState.STABILISED]: require('../../assets/audio/stabilised_base.mp3'),
  'Ney':                       require('../../assets/audio/ney_layer.mp3'),
  'Breath':                    require('../../assets/audio/breath_whoosh.mp3'),
};

const { width, height } = Dimensions.get('window');
const CX = width / 2;
const CY = height / 2;

const COLORS: Record<BreathingState, string> = {
  [BreathingState.NARROWED]:   '#E53E3E',
  [BreathingState.TRANSITION]: '#D69E2E',
  [BreathingState.EXPANDED]:   '#0096C7',
  [BreathingState.STABILISED]: '#38A169',
};

export const MindscapeRenderer: React.FC<{
  state: BreathingState;
  rmsValue: SharedValue<number>; 
  phase: 'Inhale' | 'Exhale' | 'Silence';
  onAudioReady?: (ready: boolean) => void;
}> = ({ state, rmsValue, phase, onAudioReady }) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterFilterRef = useRef<BiquadFilterNode | null>(null);
  const layers = useRef<Record<string, any>>({});
  const stateRef = useRef(state);
  const loadedCount = useRef(0);
  const [isAudioReady, setIsAudioReady] = useState(false);
  
  useEffect(() => { stateRef.current = state; }, [state]);

  const bgOpacity = useSharedValue(0.15);
  const outerR = useDerivedValue(() => {
    const cfgBaseR = stateRef.current === BreathingState.NARROWED ? 80 : 
                     stateRef.current === BreathingState.TRANSITION ? 100 : 
                     stateRef.current === BreathingState.EXPANDED ? 120 : 130;
    return cfgBaseR + Math.min(rmsValue.value * 2500, 80);
  }, [rmsValue]);

  const innerR = useDerivedValue(() => outerR.value * 0.45, [outerR]);

  // 1. AUDIO ENGINE SETUP
  useEffect(() => {
    let isMounted = true;
    let ctx: AudioContext | null = null;

    const setup = async () => {
      // 500ms delay to ensure native TurboModule wiring is ready
      await new Promise(r => setTimeout(r, 500));
      if (!isMounted) return;

      try {
        ctx = new AudioContext();
        audioContextRef.current = ctx;

        const masterGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        
        masterGain.connect(filter);
        filter.connect(ctx.destination);
        masterFilterRef.current = filter;

        const setupLayer = async (name: string, module: any, pan: number) => {
          try {
            const asset = Asset.fromModule(module);
            await asset.downloadAsync();
            const uri = asset.localUri || asset.uri;
            if (!uri) throw new Error("No URI");

            const response = await fetch(uri);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx!.decodeAudioData(arrayBuffer);
            const source = ctx!.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = true;
            const gainNode = ctx!.createGain();
            gainNode.gain.value = 0;
            
            if (ctx!.createStereoPanner) {
              const panner = ctx!.createStereoPanner();
              panner.pan.value = pan;
              source.connect(gainNode).connect(panner).connect(masterGain);
            } else {
              source.connect(gainNode).connect(masterGain);
            }
            
            source.start(0);
            layers.current[name] = gainNode;
          } catch (err) {
            console.error(`Layer ${name} error:`, err);
          } finally {
            loadedCount.current += 1;
            if (loadedCount.current === 6 && isMounted) {
              setIsAudioReady(true);
              onAudioReady?.(true);
            }
          }
        };

        await setupLayer(BreathingState.NARROWED, AUDIO_ASSETS[BreathingState.NARROWED], 0);
        await setupLayer(BreathingState.TRANSITION, AUDIO_ASSETS[BreathingState.TRANSITION], -0.2);
        await setupLayer(BreathingState.EXPANDED, AUDIO_ASSETS[BreathingState.EXPANDED], 0.2);
        await setupLayer(BreathingState.STABILISED, AUDIO_ASSETS[BreathingState.STABILISED], 0);
        await setupLayer('Ney', AUDIO_ASSETS['Ney'], 0.4);
        await setupLayer('Breath', AUDIO_ASSETS['Breath'], -0.4);

      } catch (err) {
        console.error("Audio Engine Startup Error:", err);
      }
    };

    setup();

    return () => {
      isMounted = false;
      if (ctx) ctx.close();
    };
  }, []);

  // 2. STATE SYNC
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !isAudioReady) return;
    const now = ctx.currentTime;
    const fade = 4.0;

    Object.entries(layers.current).forEach(([name, node]) => {
      if (name === 'Breath' || name === 'Ney') return;
      node.gain.linearRampToValueAtTime(0, now + fade);
    });

    if (layers.current[state]) {
      layers.current[state].gain.linearRampToValueAtTime(0.6, now + fade);
    }
    bgOpacity.value = withTiming(state === BreathingState.NARROWED ? 0.4 : 0.15, { duration: 2500 });
  }, [state, isAudioReady]);

  // 3. EXTREME BREATH SYNC
  useEffect(() => {
    const ctx = audioContextRef.current;
    const filter = masterFilterRef.current;
    if (!ctx || !filter || !isAudioReady) return;
    const now = ctx.currentTime;

    const neyMax: Record<BreathingState, number> = {
      [BreathingState.NARROWED]: 0,
      [BreathingState.TRANSITION]: 0.3,
      [BreathingState.EXPANDED]: 0.7,
      [BreathingState.STABILISED]: 1.0,
    };

    if (phase === 'Inhale') {
      filter.frequency.exponentialRampToValueAtTime(4500, now + 0.5);
      if (layers.current[state]) layers.current[state].gain.linearRampToValueAtTime(1.0, now + 0.4);
      if (layers.current['Ney']) layers.current['Ney'].gain.linearRampToValueAtTime(neyMax[state], now + 0.7);
      
      if (layers.current['Breath']) {
        const b = layers.current['Breath'];
        b.gain.setValueAtTime(0, now);
        b.gain.linearRampToValueAtTime(0.5, now + 0.1);
        b.gain.linearRampToValueAtTime(0, now + 0.5);
      }
    } else if (phase === 'Exhale') {
      filter.frequency.exponentialRampToValueAtTime(300, now + 1.2);
      if (layers.current[state]) layers.current[state].gain.linearRampToValueAtTime(0.1, now + 1.0);
      if (layers.current['Ney']) layers.current['Ney'].gain.linearRampToValueAtTime(neyMax[state] * 0.15, now + 1.5);
    } else {
      filter.frequency.linearRampToValueAtTime(800, now + 1.5);
    }
  }, [phase, state, isAudioReady]);

  return (
    <View style={styles.container}>
      <Canvas style={styles.canvas}>
        <Group>
          <BlurMask blur={50} style="normal" />
          <Circle cx={CX} cy={CY} r={outerR} color={COLORS[state]} opacity={bgOpacity} />
        </Group>
        <Circle cx={CX} cy={CY} r={innerR} color={COLORS[state]} opacity={0.9} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  canvas: { flex: 1 },
});
