import { readFileSync } from 'node:fs';

// Files contain one pattern per line. Blank lines and whole-line comments are ignored.
export function loadPatterns(sender, file) {
  const lines = file ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const entries = lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (sender) entries.push(sender);
  const patterns = [...new Set(entries.map(value => value.trim().toLowerCase()))];
  if (!patterns.length) throw new Error('Provide --sender PATTERN or a nonempty --file PATH.');
  for (const pattern of patterns) {
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9*.-]+\.[a-z0-9*-]+$/i.test(pattern)) {
      throw new Error(`Invalid sender pattern: ${JSON.stringify(pattern)}`);
    }
  }
  return patterns;
}

// Escape regex punctuation. Only * is special, and it never crosses the @ boundary.
// Consecutive stars are equivalent. Dots remain literal in both halves.
export function compilePatterns(patterns) {
  return patterns.map(pattern => new RegExp('^' + pattern.split(/\*+/).map(
    part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('[^@]*') + '$', 'i'));
}
