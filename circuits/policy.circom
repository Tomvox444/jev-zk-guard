pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/*
  PolicyCompliance — Groth16 zk-SNARK

  PRIVATE witness: Jev scores scaled to ints in [0, 1000]
  PUBLIC inputs: thresholds, decision (0=allow, 1=review, 2=deny), cmdHash

  Proves private scores are consistent with the public decision under
  public thresholds — verifier never sees the scores.
*/
template PolicyCompliance() {
    signal input dangerous;   // private
    signal input exfil;       // private
    signal input offPolicy;   // private
    signal input benign;      // private

    signal input dangerousMax; // public
    signal input exfilMax;     // public
    signal input offPolicyMax; // public
    signal input benignMin;    // public
    signal input decision;     // public 0|1|2
    signal input cmdHash;      // public

    component dBits = Num2Bits(10);
    component eBits = Num2Bits(10);
    component oBits = Num2Bits(10);
    component bBits = Num2Bits(10);
    dBits.in <== dangerous;
    eBits.in <== exfil;
    oBits.in <== offPolicy;
    bBits.in <== benign;

    // Match policy.ts: violate when score >= max (so allow needs score < max)
    component dOk = LessThan(10);
    dOk.in[0] <== dangerous;
    dOk.in[1] <== dangerousMax;

    component eOk = LessThan(10);
    eOk.in[0] <== exfil;
    eOk.in[1] <== exfilMax;

    component oOk = LessThan(10);
    oOk.in[0] <== offPolicy;
    oOk.in[1] <== offPolicyMax;

    // allow needs benign >= min  →  min <= benign
    component bOk = LessEqThan(10);
    bOk.in[0] <== benignMin;
    bOk.in[1] <== benign;

    signal allowPart1;
    signal allowPart2;
    allowPart1 <== dOk.out * eOk.out;
    allowPart2 <== oOk.out * bOk.out;
    signal allowOk;
    allowOk <== allowPart1 * allowPart2;

    // Deny when dangerous >= max OR exfil >= max  →  NOT dOk OR NOT eOk
    signal dHigh;
    signal eHigh;
    dHigh <== 1 - dOk.out;
    eHigh <== 1 - eOk.out;
    signal denyOk;
    denyOk <== dHigh + eHigh - dHigh * eHigh;

    signal notAllow;
    signal notDeny;
    notAllow <== 1 - allowOk;
    notDeny <== 1 - denyOk;
    signal reviewOk;
    reviewOk <== notAllow * notDeny;

    component isAllow = IsEqual();
    isAllow.in[0] <== decision;
    isAllow.in[1] <== 0;

    component isReview = IsEqual();
    isReview.in[0] <== decision;
    isReview.in[1] <== 1;

    component isDeny = IsEqual();
    isDeny.in[0] <== decision;
    isDeny.in[1] <== 2;

    signal flags;
    flags <== isAllow.out + isReview.out + isDeny.out;
    flags === 1;

    isAllow.out * (1 - allowOk) === 0;
    isReview.out * (1 - reviewOk) === 0;
    isDeny.out * (1 - denyOk) === 0;

    signal cmdHashSq;
    cmdHashSq <== cmdHash * cmdHash;
}

component main {
    public [
        dangerousMax,
        exfilMax,
        offPolicyMax,
        benignMin,
        decision,
        cmdHash
    ]
} = PolicyCompliance();
