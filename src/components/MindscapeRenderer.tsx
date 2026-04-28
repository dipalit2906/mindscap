import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Canvas, Circle, Group, BlurMask, RoundedRect, vec } from '@shopify/react-native-skia';
import {
  useSharedValue,
  withTiming,
  useDerivedValue,
  SharedValue,
  withSequence,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { MindscapeState } from '../hooks/useMindscapeSession';
import { AudioContext, BiquadFilterNode } from 'react-native-audio-api';

const { width, height } = Dimensions.get('window');
const CX = width / 2;
const CY = height / 2;

const COLORS: Record<MindscapeState, string> = {
  [MindscapeState.NARROWED]: '#FF7096', // Pink
  [MindscapeState.TRANSITION]: '#FFB347', // Orange
  [MindscapeState.EXPANDED]: '#00FF99', // Green
  [MindscapeState.STABILISED]: '#00CED1', // Teal
};

interface RendererProps {
  state: MindscapeState;
  rmsValue: SharedValue<number>;
  phase: string;
  isAwarenessMoment: boolean;
  onAudioReady?: (ready: boolean) => void;
}

export const MindscapeRenderer: React.FC<RendererProps> = ({
  state,
  rmsValue,
  phase,
  isAwarenessMoment,
  onAudioReady
}) => {
  const [visualState, setVisualState] = useState(state);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterFilterRef = useRef<BiquadFilterNode | null>(null);
  const layers = useRef<Record<string, any>>({});
  const isReady = useRef(false);

  // Animation values
  const rotation = useSharedValue(0);
  const phaseScale = useSharedValue(1);
  const awarenessPulse = useSharedValue(1);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 15000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisualState(state);
    }, 300);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (phase === 'Inhale') {
      phaseScale.value = withTiming(1.6, { duration: 1500 });
    } else {
      phaseScale.value = withTiming(1.0, { duration: 2500 });
    }
  }, [phase]);

  useEffect(() => {
    if (isAwarenessMoment) {
      awarenessPulse.value = withSequence(
        withTiming(1.4, { duration: 1000 }),
        withTiming(1, { duration: 1000 })
      );
    }
  }, [isAwarenessMoment]);

  // Derived values for shapes
  // Dampen the raw volume to prevent UI flickering/jittering
  const breathAmp = useDerivedValue(() => Math.min(Math.sqrt(rmsValue.value) * 400, 100));
  
  // Base ring expands significantly on inhale (phaseScale)
  const baseR = useDerivedValue(() => (90 + breathAmp.value) * phaseScale.value * awarenessPulse.value);
  
  // Generous spacing that expands naturally, matching the screenshot
  const spacing = 18;
  const ring1 = useDerivedValue(() => baseR.value + (spacing * 1) * phaseScale.value);
  const ring2 = useDerivedValue(() => baseR.value + (spacing * 2) * phaseScale.value);
  const ring3 = useDerivedValue(() => baseR.value + (spacing * 3) * phaseScale.value);
  const ring4 = useDerivedValue(() => baseR.value + (spacing * 4) * phaseScale.value);
  const ring5 = useDerivedValue(() => baseR.value + (spacing * 5) * phaseScale.value);
  const ring6 = useDerivedValue(() => baseR.value + (spacing * 6) * phaseScale.value);

  // --- AUDIO ENGINE ---
  useEffect(() => {
    let ctx: AudioContext | null = null;
    const setup = async () => {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      filter.connect(ctx.destination);
      masterFilterRef.current = filter;
      isReady.current = true;
      onAudioReady?.(true);
    };
    setup();
    return () => ctx?.close();
  }, []);

  useEffect(() => {
    if (!isReady.current || !masterFilterRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const filter = masterFilterRef.current;
    const fade = 2.5;

    if (state === MindscapeState.NARROWED) filter.frequency.linearRampToValueAtTime(400, now + fade);
    if (state === MindscapeState.EXPANDED) filter.frequency.linearRampToValueAtTime(2000, now + fade);
    if (state === MindscapeState.STABILISED) filter.frequency.linearRampToValueAtTime(150, now + fade);
  }, [state]);

  return (
    <View style={styles.container}>
      <Canvas style={styles.canvas}>
        {/* Glow effect behind the main ring */}
        <Group>
          <BlurMask blur={30} style="normal" />
          <Circle cx={CX} cy={CY} r={baseR} style="stroke" strokeWidth={20} color={COLORS[visualState]} opacity={0.3} />
        </Group>

        {/* Main Thick Ring */}
        <Circle cx={CX} cy={CY} r={baseR} style="stroke" strokeWidth={8} color={COLORS[visualState]} opacity={0.9}>
          <BlurMask blur={2} style="solid" />
        </Circle>

        {/* 6 Thin Concentric Rings */}
        <Circle cx={CX} cy={CY} r={ring1} style="stroke" strokeWidth={2} color={COLORS[visualState]} opacity={0.6} />
        <Circle cx={CX} cy={CY} r={ring2} style="stroke" strokeWidth={1.5} color={COLORS[visualState]} opacity={0.4} />
        <Circle cx={CX} cy={CY} r={ring3} style="stroke" strokeWidth={1} color={COLORS[visualState]} opacity={0.25} />
        <Circle cx={CX} cy={CY} r={ring4} style="stroke" strokeWidth={1} color={COLORS[visualState]} opacity={0.15} />
        <Circle cx={CX} cy={CY} r={ring5} style="stroke" strokeWidth={0.5} color={COLORS[visualState]} opacity={0.08} />
        <Circle cx={CX} cy={CY} r={ring6} style="stroke" strokeWidth={0.5} color={COLORS[visualState]} opacity={0.04} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  canvas: { flex: 1 },
});
