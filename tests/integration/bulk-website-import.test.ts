import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { cleanDatabase } from '../test-utils';
import { createImportJob, submitReadyCandidates } from '@/lib/website-import-service';
let admin:string;
beforeAll(async()=>{await cleanDatabase();admin=(await prisma.user.create({data:{username:'bulk_import_admin',passwordHash:'unused',role:'ADMIN'}})).id;
await prisma.course.createMany({data:[{code:'BULK1',name:'批量课程',credits:1},{code:'BULK2',name:'批量课程',credits:1}]});});
afterAll(async()=>{await cleanDatabase();await prisma.$disconnect();});
describe('one click website submissions',()=>{
 it('submits a general entry with no fictional course and deduplicates repeats',async()=>{
  const job=await createImportJob(admin,'https://example.org/',{title:'通用资源目录',summary:'外部入口'});
  const first=await submitReadyCandidates(admin,job.id);
  expect(first.results[0]?.status).toBe('SUBMITTED');
  const resource=await prisma.resource.findUniqueOrThrow({where:{id:first.results[0]!.resourceId},include:{courseResources:true}});
  expect(resource.status).toBe('DRAFT');expect(resource.courseResources).toHaveLength(0);
  expect((await submitReadyCandidates(admin,job.id)).results).toHaveLength(0);
  const second=await createImportJob(admin,'https://example.org/',{title:'重复入口',summary:''});
  expect((await submitReadyCandidates(admin,second.id)).results[0]?.status).toBe('DUPLICATE');
 });
 it('auto-confirms unique courses, skips ambiguous and unmatched courses',async()=>{
  const job=await createImportJob(admin,'https://example.org/learning/');
  await prisma.websiteImportJob.update({where:{id:job.id},data:{status:'COMPLETED'}});
  for (const [i,codes] of [['a',['BULK1']],['b',['BULK1','BULK2']],['c',[]]] as const)
   await prisma.websiteImportCandidate.create({data:{jobId:job.id,title:'批量课程'+i,url:`https://example.org/${i}/`,canonicalUrl:`https://example.org/${i}/`,summary:'',courseCodes:[...codes],matchReason:'测试'}});
  const result=await submitReadyCandidates(admin,job.id);
  expect(result.results).toHaveLength(1);expect(result.skipped).toBe(2);expect(result.results[0]?.status).toBe('SUBMITTED');
  const fallback=await submitReadyCandidates(admin,job.id,true);
  expect(fallback.results).toHaveLength(2);expect(fallback.skipped).toBe(0);
  const converted=await prisma.websiteImportCandidate.findMany({where:{jobId:job.id,resourceScope:'GENERAL'}});
  expect(converted).toHaveLength(2);expect(converted.every(c=>JSON.stringify(c.courseCodes)==='[]')).toBe(true);
 });
 it('rejects stale admin privileges and active scans',async()=>{
  const job=await createImportJob(admin,'https://example.org/other/');
  await expect(submitReadyCandidates(admin,job.id)).rejects.toThrow('扫描完成');
  await prisma.user.update({where:{id:admin},data:{role:'VISITOR'}});
  await expect(submitReadyCandidates(admin,job.id)).rejects.toThrow('管理员');
 });
});
