export const baseStyles = `
  :root { --normal: #2e7d32; --warning: #ef6c00; --alert: #c62828; --muted: #6b7280; --border: #e5e7eb; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
  header { padding: 16px 24px; background: #111827; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  header h1 { margin: 0; font-size: 20px; }
  header a { color: #fff; font-size: 14px; }
  main { max-width: 1040px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
  section { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 16px; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
  select, input, textarea, button { font: inherit; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; }
  button { cursor: pointer; background: #111827; color: #fff; border-color: #111827; }
  button.secondary { background: #fff; color: #111827; }
  button:disabled { opacity: 0.5; cursor: wait; }
  #message { min-height: 20px; font-size: 14px; color: var(--muted); }
  #message.error { color: var(--alert); }
`;
