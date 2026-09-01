import { BusinessDocumentPage } from "@/components/business-document-page";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <BusinessDocumentPage kind="purchase-order" id={Number((await params).id)} />; }
