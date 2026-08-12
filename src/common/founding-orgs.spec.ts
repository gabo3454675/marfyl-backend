import { isIvaDisabledOrgSlug, IVA_DISABLED_ORG_SLUGS } from "./founding-orgs";

describe("isIvaDisabledOrgSlug", () => {
  it("should return true for davean", () => {
    expect(isIvaDisabledOrgSlug("davean")).toBe(true);
  });

  it("should return true for el-rancho-de-german", () => {
    expect(isIvaDisabledOrgSlug("el-rancho-de-german")).toBe(true);
  });

  it("should return false for other slugs", () => {
    expect(isIvaDisabledOrgSlug("monddy")).toBe(false);
    expect(isIvaDisabledOrgSlug("otra-org")).toBe(false);
    expect(isIvaDisabledOrgSlug("")).toBe(false);
  });

  it("should return false for null", () => {
    expect(isIvaDisabledOrgSlug(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isIvaDisabledOrgSlug(undefined)).toBe(false);
  });

  it("IVA_DISABLED_ORG_SLUGS should contain davean and el-rancho-de-german", () => {
    expect(IVA_DISABLED_ORG_SLUGS).toContain("davean");
    expect(IVA_DISABLED_ORG_SLUGS).toContain("el-rancho-de-german");
  });
});
