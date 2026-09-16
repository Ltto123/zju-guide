import { describe, it, expect } from 'vitest';
import { candidateUpdateSchema } from '../../src/lib/website-import-policy';
describe('general website entries', () => {
  const data={title:'核心资源导航',summary:'网站入口',type:'BLOG',applicableStage:'COURSE',courseCodes:[]};
  it('allows explicitly general entries without inventing a course', () => {
    expect(candidateUpdateSchema.parse({...data,resourceScope:'GENERAL'}).courseCodes).toEqual([]);
  });
  it('still requires course associations for course resources', () => {
    expect(()=>candidateUpdateSchema.parse(data)).toThrow();
  });
});
