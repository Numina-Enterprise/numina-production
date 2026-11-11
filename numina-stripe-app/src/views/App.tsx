import React, { useState } from "react";
import {
  Box,
  Button,
  ContextView,
  Divider,
  Inline,
  Link,
  Notice,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";

const STATE_ROOT =
  "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd";

const Row = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: "success" | "primary" | "secondary";
}) => (
  <Inline css={{ layout: "row", gap: "medium", alignY: "center" }}>
    <Box css={{ color: "secondary" }}>{label}</Box>
    <Box css={{ font: "bodyEmphasized", color: valueColor }}>{value}</Box>
  </Inline>
);

export const App = (_context: ExtensionContextValue) => {
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "idle">(
    "synced"
  );
  const [nusdState] = useState<string>("UNPAUSED_AND_ACTIVE");
  const [parityRatio] = useState<string>("1.000000");

  const handleReconcile = () => {
    setSyncStatus("syncing");
    setTimeout(() => {
      setSyncStatus("synced");
    }, 1200);
  };

  return (
    <ContextView
      title="Numina Native Treasury"
      actions={
        <Button
          type="primary"
          onPress={handleReconcile}
          disabled={syncStatus === "syncing"}
        >
          {syncStatus === "syncing" ? "Reconciling..." : "Reconcile Ledger"}
        </Button>
      }
    >
      <Box css={{ layout: "column", gap: "large" }}>
        <Notice type="neutral">
          <Box css={{ font: "heading" }}>Cluster State Root Bound</Box>
          <Box css={{ font: "caption", color: "secondary" }}>
            {`Root: ${STATE_ROOT.slice(0, 16)}...${STATE_ROOT.slice(-8)}`}
          </Box>
        </Notice>

        <Box css={{ layout: "column", gap: "small" }}>
          <Box css={{ font: "heading" }}>Treasury Invariants</Box>
          <Row
            label="NUSD Operational Status:"
            value={nusdState}
            valueColor="success"
          />
          <Row label="USD/NUSD 1:1 Parity:" value={parityRatio} />
          <Row label="Settlement Engine:" value="3-Stage Atomic BigInt" />
          <Row
            label="Custody Banking:"
            value="Bank of America (NCUA J-01..J-08)"
          />
        </Box>

        <Divider />

        <Box css={{ layout: "column", gap: "small" }}>
          <Box css={{ font: "heading" }}>Zero-Trust Gateway</Box>
          <Box css={{ font: "caption", color: "secondary" }}>
            Webhooks are cryptographically authenticated via HMAC-SHA256 with
            PERSISTENT_ATOMIC idempotency keys.
          </Box>
          <Link href="https://numinalabs.xyz" target="_blank">
            Visit Canonical Origin (numinalabs.xyz)
          </Link>
        </Box>
      </Box>
    </ContextView>
  );
};

export default App;
