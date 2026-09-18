import { PageHeader } from '../../shared-components/primitives/ui';
import { PostbackTester } from '../../features/postback/PostbackTester';

/** Standalone affiliate postback tester (Affiliates › Postbacks Test). */
export default function PostbackTestPage() {
  return (
    <>
      <PageHeader title="Postbacks Test" subtitle="Fire a test postback with sample macros to verify an affiliate integration." />
      <div className="card max-w-2xl mx-auto">
        <PostbackTester testPath="/api/catalog/postbacks/test" />
      </div>
    </>
  );
}
