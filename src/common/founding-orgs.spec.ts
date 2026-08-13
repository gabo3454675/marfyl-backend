import {
  isConcertModuleEnabledForOrg,
  isBillingExemptOrg,
  isIvaDisabledOrgSlug,
} from "./founding-orgs";

describe("isConcertModuleEnabledForOrg", () => {
  it("apaga concierto en Monddy si concertModuleEnabled es false", () => {
    expect(
      isConcertModuleEnabledForOrg({
        slug: "monddy",
        concertModuleEnabled: false,
      }),
    ).toBe(false);
  });

  it("enciende concierto solo cuando el flag de la org es true", () => {
    expect(
      isConcertModuleEnabledForOrg({
        slug: "monddy",
        concertModuleEnabled: true,
      }),
    ).toBe(true);
  });

  it("nunca enciende concierto en El Rancho sin flag", () => {
    expect(
      isConcertModuleEnabledForOrg({
        slug: "el-rancho-de-german",
        concertModuleEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("founding orgs helpers", () => {
  it("El Rancho sigue sin IVA", () => {
    expect(isIvaDisabledOrgSlug("el-rancho-de-german")).toBe(true);
    expect(isIvaDisabledOrgSlug("monddy")).toBe(false);
  });

  it("Monddy y El Rancho siguen exentos de billing", () => {
    expect(isBillingExemptOrg({ slug: "monddy" })).toBe(true);
    expect(isBillingExemptOrg({ slug: "el-rancho-de-german" })).toBe(true);
  });
});
