import { Suspense } from "react";
import { TransactionsScreen } from "@/components/screens/TransactionsScreen";

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-forest-900 font-bold">جاري تحميل الحركات...</div>}>
      <TransactionsScreen />
    </Suspense>
  );
}
