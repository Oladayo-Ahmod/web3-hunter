import { describe, expect, it } from "vitest";
import { checkApplyEligibility } from "./apply-eligibility";

// Real production titles found in a live Milestone 20 audit of /today's
// Apply section — each one an actual, currently-open posting at a
// curated, priority-tagged Company. These are regression tests against
// specific bad results that were shipping, not synthetic examples.

describe("checkApplyEligibility — real production regressions (Milestone 20)", () => {
  it("excludes BitGo's Application Security Engineer (enterprise AppSec, zero blockchain specificity)", () => {
    const description =
      "We are looking for a versatile Application Security Engineer to join the team to continue to mature the application security practices at BitGo. Perform application security vulnerability management. Support the bug bounty program. Experience with OWASP, static/dynamic analysis, and common security tools. Mature the security program through the use of the NIST CSF.";
    const result = checkApplyEligibility("Application Security Engineer", description);
    expect(result.eligible).toBe(false);
  });

  it("excludes Figure's Application Security Engineer (OWASP/CI-CD/NIST work, only marketing copy mentions blockchain)", () => {
    const description =
      "Figure (NASDAQ: FIGR) is transforming capital markets through blockchain. As an Application Security Engineer at Figure, you will architect firewalls, intrusion detection, encryption protocols. Collaborate with DevOps to integrate security into CI/CD pipelines. Manage third-party penetration tests.";
    const result = checkApplyEligibility("Application Security Engineer ", description);
    expect(result.eligible).toBe(false);
  });

  it('excludes Near Foundation\'s "Senior Security Engineer" (internally an IT security role)', () => {
    const description =
      "We are hiring a Senior IT Security Engineer to be the deep technical owner of our information security work. You will bring the technical depth to design, harden, and automate the security systems and controls our team and ecosystem rely on.";
    const result = checkApplyEligibility("Senior Security Engineer", description);
    expect(result.eligible).toBe(false);
  });

  it("excludes BitGo's generic Backend Engineer (Node/TypeScript/Postgres, blockchain only a nice-to-have)", () => {
    const description =
      "BitGo is looking for a Backend Engineer - E2 to join our Ecosystem Vertical. Strong experience with TypeScript, Node.js and Express. Strong experience with Node.js, TypeScript, PostgreSQL and MongoDB. Understanding of and strong interest in cryptocurrencies and blockchain.";
    const result = checkApplyEligibility("Backend Engineer E2 - Ecosystem", description);
    expect(result.eligible).toBe(false);
  });

  it("includes Somnia's Engineering Lead — Security (explicitly EVM/smart contract security/DeFi attack surfaces)", () => {
    const description =
      "Own the security posture of the L1 infrastructure. Cryptography fundamentals as applied to blockchain and key management. Nice to Have: EVM, smart contract security, and DeFi attack surfaces (MEV, bridges, oracles). Securing blockchain L1/L2 node and validator infrastructure.";
    const result = checkApplyEligibility("Engineering Lead — Security", description);
    expect(result.eligible).toBe(true);
  });

  it("includes Somnia's Senior Infrastructure Engineer once the description names real node/validator operations", () => {
    const description =
      "We're looking for a Senior Infrastructure Engineer to build and run Somnia's key backend services: the L1 and node fleet, RPC and indexing layers. Operate the systems behind Somnia's nodes, validators, RPC and indexing, tuning for performance and cost across regions.";
    const result = checkApplyEligibility("Senior Infrastructure Engineer", description);
    expect(result.eligible).toBe(true);
  });

  it("includes Ava Labs' generic-titled Staff Engineer once the description confirms real protocol work", () => {
    const description =
      "Ava Labs is hiring a Staff Engineer into the Platform Engineering Group to serve as a full-time maintainer of AvalancheGo and the technical anchor for the node domain: consensus, peer-to-peer networking, state sync, the VM plugin interface, and the node's integration with the C-Chain EVM (coreth and libevm).";
    const result = checkApplyEligibility("Staff Engineer, AvalancheGo", description);
    expect(result.eligible).toBe(true);
  });

  it('includes MoonPay\'s "Senior Blockchain Engineer" on title alone', () => {
    const result = checkApplyEligibility("Senior Blockchain Engineer", null);
    expect(result.eligible).toBe(true);
  });

  it('includes titles the phrase-order gap previously missed, e.g. "Blockchain Platform Engineer"', () => {
    const result = checkApplyEligibility("Blockchain Platform Engineer", null);
    expect(result.eligible).toBe(true);
  });

  it.each([
    "Senior QA Engineer (Contractor)",
    "Operations Lead",
    "Senior Mobile Engineer (React Native)",
    "Data Insights & Analytics Lead",
    "Senior/Staff Data Analyst",
    "Strategic FP&A Analyst",
    "Operations Officer",
    "Product Counsel",
    "Software Development Engineer in Test (SDET)",
    "Senior Data Engineer",
    "Senior Accountant, Crypto",
    "Go-to-Market Lead",
    "IT Department Lead - Remote, Worldwide",
    "Finance Lead",
    "Capital Markets Lead",
  ])(
    'excludes "%s" — no Web3 role signal at all, only present via unrelated skill overlap',
    (title) => {
      const result = checkApplyEligibility(title, null);
      expect(result.eligible).toBe(false);
    },
  );

  it.each([
    "Smart Contract Security Engineer",
    "Smart Contract Auditor",
    "Solidity Engineer",
    "Protocol Engineer",
    "Blockchain Engineer",
    "Web3 Engineer",
    "DeFi Engineer",
    "ZK Engineer",
  ])('includes clearly Web3-specific title "%s"', (title) => {
    const result = checkApplyEligibility(title, null);
    expect(result.eligible).toBe(true);
  });

  it.each([
    "Cloud Security Engineer",
    "Corporate Security Engineer",
    "IT Security Analyst",
    "Senior Java Backend Engineer — Asset & Earn",
  ])(
    'excludes "%s" regardless of description — a negative role signal overrides company Web3 identity',
    (title) => {
      const result = checkApplyEligibility(
        title,
        "This role touches blockchain and smart contracts daily.",
      );
      expect(result.eligible).toBe(false);
    },
  );

  it("excludes a title with no signal at all and no description to check", () => {
    const result = checkApplyEligibility("Senior Software Engineer", null);
    expect(result.eligible).toBe(false);
  });

  it("includes a generic title once the description names concrete Web3 protocol work", () => {
    const result = checkApplyEligibility(
      "Senior Software Engineer",
      "You'll write Solidity smart contracts and work on our EVM rollup.",
    );
    expect(result.eligible).toBe(true);
  });
});
