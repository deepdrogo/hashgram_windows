// Countries Local offers. Codes are ISO 3166-1 alpha-2.
//
// A country on Hashgram is always self-declared: it is an attribute the
// author signs into their own profile. Nothing in the app infers a country
// from an IP address, a connection, a node or a language, and this list
// exists so that what people declare is at least spelled the same way.
export interface Country {
  code: string;
  name: string;
}

export const COUNTRIES: Country[] = [
  { code: "GE", name: "Georgia" },
  { code: "AM", name: "Armenia" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "TR", name: "Türkiye" },
  { code: "UA", name: "Ukraine" },
  { code: "PL", name: "Poland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AU", name: "Australia" },
];

/** The country's name, or the code itself when it is not in the list. */
export function countryName(code: string): string {
  const c = code.trim().toUpperCase();
  return COUNTRIES.find((x) => x.code === c)?.name ?? c;
}
