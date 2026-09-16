import { test, expect } from "@playwright/test";

test("bulk approval captures current batch, reports conflicts and clears old selection", async ({ page }) => {
  const item = (id: string) => ({ id, resource: { id, title: `资源 ${id}`, type: "BLOG", url: null, summary: null, applicableStage: null }, submitter: { id: "admin", username: "管理员" }, submittedAt: "2026-09-15T00:00:00Z", reviewedAt: null, result: null, reason: null, courses: [] });
  let pending = [item("first"), item("second")];
  const bodies: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test");
    localStorage.setItem("qiushi:guide:v1:admin", "seen");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/api/auth/me") data = { id: "admin", username: "管理员", role: "ADMIN" };
    else if (url.pathname === "/api/me/programs") data = [{ id: "program" }];
    else if (url.pathname === "/api/admin/submissions") data = { pending: url.searchParams.get("batch") ? pending : [item("other")], reviewed: [] };
    else if (url.pathname.endsWith("/bulk-approve")) {
      bodies.push(route.request().postDataJSON());
      pending = [item("second")];
      data = { results: [{ id: "first", status: "APPROVED" }, { id: "second", status: "WITHDRAWN" }] };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/admin/review?batch=old");
  await page.getByRole("checkbox", { name: "全选当前待审核项（最多100项）" }).check();
  await expect(page.getByRole("button", { name: "通过选中（2）" })).toBeEnabled();
  await page.getByRole("button", { name: "通过选中（2）" }).click();
  await expect(page.getByText("second：批次已撤回")).toBeVisible();
  expect(bodies).toEqual([{ submissionIds: ["first", "second"] }]);
  await expect(page.getByRole("button", { name: "通过选中（0）" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "选择 资源 second", exact: true }).check();
  await page.getByRole("button", { name: "查看全部投稿" }).click();
  await expect(page.getByRole("checkbox", { name: "选择 资源 other", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "通过选中（0）" })).toBeDisabled();
  await page.getByRole("button", { name: "一键通过当前1项" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ submissionIds: ["other"] });
});
