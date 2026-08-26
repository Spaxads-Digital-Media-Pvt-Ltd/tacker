import { PageHeader } from '../../components/ui';
import { PostbackTester } from '../../components/PostbackTester';

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
