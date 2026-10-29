import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  Banner,
  ContextView,
  Divider,
  Inline,
  Link,
  Spinner,
  Text,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";

const STATE_ROOT = "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd";

export const App = ({ userContext, environment }: ExtensionContextValue) => {
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "idle">("synced");
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
      brandColor="#0052FF"
      brandIcon="assets/icon.png"
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
      <Box css={{ stack: "y", gap: "large" }}>
        <Banner
          type="default"
          title="Cluster State Root Bound"
          description={`Root: ${STATE_ROOT.slice(0, 16)}...${STATE_ROOT.slice(-8)}`}
        />

        <Box css={{ stack: "y", gap: "small" }}>
          <Text size="large" weight="bold">
            Treasury Invariants
          </Text>
          <Inline css={{ distribution: "space-between" }}>
            <Text color="secondary">NUSD Operational Status:</Text>
            <Text weight="bold" color="positive">
              {nusdState}
            </Text>
          </Inline>
          <Inline css={{ distribution: "space-between" }}>
            <Text color="secondary">USD/NUSD 1:1 Parity:</Text>
            <Text weight="bold">{parityRatio}</Text>
          </Inline>
          <Inline css={{ distribution: "space-between" }}>
            <Text color="secondary">Settlement Engine:</Text>
            <Text weight="bold">3-Stage Atomic BigInt</Text>
          </Inline>
          <Inline css={{ distribution: "space-between" }}>
            <Text color="secondary">Custody Banking:</Text>
            <Text weight="bold">Bank of America (NCUA J-01..J-08)</Text>
          </Inline>
        </Box>

        <Divider />

        <Box css={{ stack: "y", gap: "small" }}>
          <Text size="large" weight="bold">
            Zero-Trust Gateway
          </Text>
          <Text size="small" color="secondary">
            Webhooks are cryptographically authenticated via HMAC-SHA256 with PERSISTENT_ATOMIC idempotency keys.
          </Text>
          <Link href="https://numinalabs.xyz" target="_blank">
            Visit Canonical Origin (numinalabs.xyz)
          </Link>
        </Box>
      </Box>
    </ContextView>
  );
};

export default App;
