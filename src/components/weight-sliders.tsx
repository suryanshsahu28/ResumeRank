'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import type { MetricWeights } from '@/lib/types';

interface WeightSlidersProps {
  weights: MetricWeights; // { skills: number; experience: number; education: number }
  onWeightsChange: (weights: MetricWeights) => void;
  disabled?: boolean;
}

const DEFAULT_WEIGHTS: MetricWeights = {
  skills: 35,
  experience: 35,
  education: 30,
};

const STEP = 5;
const MIN_VALUE = 20;

/* ------------------------------ helpers ------------------------------ */

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function roundToStep(n: number, step = STEP) {
  return Math.round(n / step) * step;
}

/** Deterministic "other keys" mapping keeps TS narrow and safe */
const OTHER_KEYS: Record<keyof MetricWeights, [keyof MetricWeights, keyof MetricWeights]> = {
  skills: ['experience', 'education'],
  experience: ['skills', 'education'],
  education: ['skills', 'experience'],
};

/**
 * Rebalance so skills + experience + education === 100.
 * - Fix the changed metric to newVal (clamped & step-rounded).
 * - Distribute the remainder across the other two proportionally to their current shares.
 * - Resolve rounding residue to keep exact 100 while preserving STEP multiples.
 */
function rebalance3(
  curr: MetricWeights,
  changedKey: keyof MetricWeights,
  rawNewVal: number
): MetricWeights {

  // 2) Determine the other two keys (typed)
  const [kA, kB] = OTHER_KEYS[changedKey];
  const numMetrics = 3;
  const maxPossible = 100 - (numMetrics - 1) * MIN_VALUE;

  let newVal = roundToStep(clamp(rawNewVal, MIN_VALUE, maxPossible));

  // 3) Remaining for the other two
  const remaining = 100 - newVal;

  // 4) Proportional allocation
  const a0 = curr[kA];
  const b0 = curr[kB];
  const denom = a0 + b0;

  let a: number;
  let b: number;

  if (denom === 0) {
    // If both others were 0, split the remainder, respecting min value
    a = roundToStep(clamp(remaining / 2, MIN_VALUE, 100));
    b = remaining - a;
  } else {
    // Distribute proportionally
    a = roundToStep(clamp((a0 / denom) * remaining, MIN_VALUE, 100));
    b = remaining - a; // Assign the exact remainder
  }
  
  // 4) Final check to ensure 'b' also respects the minimum value
  if (b < MIN_VALUE) {
    const diff = MIN_VALUE - b;
    b = MIN_VALUE;
    a -= diff; // Take the difference from 'a'
  }
  
  // Ensure 'a' did not fall below min value after adjustment
  if (a < MIN_VALUE) {
      const diff = MIN_VALUE - a;
      a = MIN_VALUE;
      newVal -= diff; // if a and b need to be bumped, changedKey must pay
  }

  // Final re-rounding and total correction
  a = roundToStep(a);
  b = roundToStep(b);
  newVal = roundToStep(newVal);

  let total = newVal + a + b;
  let diff = 100 - total;
  if (diff !== 0) {
    if(newVal + diff >= MIN_VALUE && newVal + diff <= maxPossible) {
        newVal += diff;
    } else if (a + diff >= MIN_VALUE) {
        a += diff;
    } else {
        b += diff;
    }
  }

  // 7) Build next object with precise keys (no computed-key widening)
  const next: MetricWeights = { skills: 0, experience: 0, education: 0 };
  next[changedKey] = newVal;
  next[kA] = a;
  next[kB] = b;

  return next;
}

/* ---------------------------- presentational ---------------------------- */

const WeightSlider: React.FC<{
  label: string;
  value: number;
  description: string;
  onChange: (value: number[]) => void;
  disabled?: boolean;
}> = ({ label, value, description, onChange, disabled }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <label className="block text-sm font-medium">{label}</label>
      <span className="text-sm font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
        {value}
      </span>
    </div>
    <Slider
      value={[value]}
      onValueChange={onChange}
      min={MIN_VALUE}
      max={100 - (Object.keys(DEFAULT_WEIGHTS).length - 1) * MIN_VALUE}
      step={STEP}
      disabled={disabled}
    />
    <p className="text-xs text-muted-foreground mt-1">{description}</p>
  </div>
);

/* ------------------------------ main export ------------------------------ */

export const WeightSliders: React.FC<WeightSlidersProps> = ({
  weights,
  onWeightsChange,
  disabled,
}) => {
  const handleSliderChange = (metric: keyof MetricWeights) => (value: number[]) => {
    const newWeights = rebalance3(weights, metric, value[0]);
    onWeightsChange(newWeights);
  };

  const resetToDefault = () => onWeightsChange(DEFAULT_WEIGHTS);

  const total = weights.skills + weights.experience + weights.education;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Analysis Weights</CardTitle>
            <CardDescription>
              Adjust the importance of each metric. (Total: {total})
            </CardDescription>
          </div>
          <Button variant="ghost" onClick={resetToDefault} disabled={disabled}>
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <WeightSlider
          label="Skills Match"
          value={weights.skills}
          onChange={handleSliderChange('skills')}
          description="Importance of skill alignment."
          disabled={disabled}
        />
        <WeightSlider
          label="Experience Relevance"
          value={weights.experience}
          onChange={handleSliderChange('experience')}
          description="Importance of relevant work experience."
          disabled={disabled}
        />
        <WeightSlider
          label="Education Background"
          value={weights.education}
          onChange={handleSliderChange('education')}
          description="Importance of educational qualifications."
          disabled={disabled}
        />
      </CardContent>
    </Card>
  );
};
