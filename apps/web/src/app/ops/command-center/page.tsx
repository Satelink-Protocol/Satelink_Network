import { redirect } from "next/navigation";

// Placeholder: the ops command center is currently served by the admin backend.
// Redirect through to the existing admin command center until the ops-native
// dashboard is built out.
export default function OpsPage() {
  redirect("https://admin.satelink.network/admin/command-center");
}
