import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), 'utf8');

test('immigration modules unlock from completed lessons while quizzes stay optional', () => {
  const logic = read('../src/lib/immigration.ts');
  const overview = read('../src/pages/student/ImmigrationOverview.tsx');

  assert.match(logic, /bySlug\.get\(lesson\.slug\)\?\.completed === true/);
  assert.doesNotMatch(logic, /lessonStatus\.has_questions \? lessonStatus\.passed/);
  assert.match(overview, /const isCleared = \(slug: string\) => bySlug\.get\(slug\)\?\.completed === true/);
  assert.doesNotMatch(overview, /valide son quiz/);
});
