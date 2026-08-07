import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { cn } from '../../utils/cn';

function scoreTone(score: number): { stroke: string; text: string } {
  if (score >= 80) return { stroke: 'var(--color-success-500)', text: 'text-[var(--color-success-600)]' };
  if (score >= 50) return { stroke: 'var(--color-warning-500)', text: 'text-[var(--color-warning-600)]' };
  return { stroke: 'var(--color-danger-500)', text: 'text-[var(--color-danger-600)]' };
}

function AnimatedScore({ score }: { score: number }) {
  const value = useMotionValue(0);
  const rounded = useTransform(value, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(value, score, { duration: 0.7, ease: 'easeOut' });
    return controls.stop;
  }, [score, value]);

  return <motion.span>{rounded}</motion.span>;
}

export function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const stroke = size >= 72 ? 5 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const tone = scoreTone(score);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-ink-100)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </svg>
      <div className={cn('absolute inset-0 flex items-center justify-center font-semibold', tone.text)} style={{ fontSize: size * 0.32 }}>
        <AnimatedScore score={score} />
      </div>
    </div>
  );
}
