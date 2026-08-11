'use client';
import { useState } from 'react';

export default function GoalSelector() {
  const [goal, setGoal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Goal submitted:', goal);
    // API call would go here
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
      <label htmlFor="goal">What is your single, measurable goal?</label>
      <input 
        id="goal"
        type="text" 
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="e.g. Lose 5kg in 6 weeks"
        required 
      />
      <button type="submit">Set Goal</button>
    </form>
  );
}
