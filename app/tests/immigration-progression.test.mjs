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
  const sql = read('../../supabase/migrations/20260902000083_progress_roles_and_crm_safety.sql');

  assert.match(logic, /bySlug\.get\(lesson\.slug\)\?\.completed === true/);
  assert.doesNotMatch(logic, /lessonStatus\.has_questions \? lessonStatus\.passed/);
  assert.match(overview, /const isCleared = \(slug: string\) => bySlug\.get\(slug\)\?\.completed === true/);
  assert.doesNotMatch(overview, /valide son quiz/);
  const accessFunction = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.can_access_immigration_lesson'));
  assert.match(accessFunction, /public\.immigration_progress/);
  assert.doesNotMatch(accessFunction, /immigration_quiz_attempts/);
});

test('Pflege lesson unlocking depends on watched completion, never quiz results', () => {
  const list = read('../src/pages/student/Lessons.tsx');
  const detail = read('../src/pages/student/LessonDetail.tsx');
  const sql = read('../../supabase/migrations/20260902000083_progress_roles_and_crm_safety.sql');
  const unlockFunction = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.is_lesson_unlocked'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.can_access_immigration_lesson'),
  );
  assert.match(list, /progressByLesson\.get\(prev\.id\)\?\.completed === true/);
  assert.match(detail, /prevProgress\?\.completed !== true/);
  assert.match(unlockFunction, /public\.lesson_progress/);
  assert.doesNotMatch(unlockFunction, /quiz/);
});
