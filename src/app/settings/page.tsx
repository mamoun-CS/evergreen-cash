import { SettingsScreen } from "@/components/screens/SettingsScreen";

// This page hydrates its settings from the local IndexedDB after mount, so it
// intentionally does not participate in instant-navigation validation.
export const instant = false;

export default function SettingsPage() {
  return <SettingsScreen />;
}
