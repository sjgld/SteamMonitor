/** Progress of a multi-step dialog: numbered dots, the current one labelled for assistive technology. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return <ol className="stepper" aria-label={`第 ${current + 1} 步，共 ${steps.length} 步`}>
    {steps.map((label, index) => <li key={label} title={label} aria-label={label}
      aria-current={index === current ? 'step' : undefined} className={index < current ? 'done' : undefined}>{index + 1}</li>)}
  </ol>;
}
