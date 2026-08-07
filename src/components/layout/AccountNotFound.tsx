import { useNavigate } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { PageContainer } from './PageContainer';
import { Button, EmptyState } from '../ui';

export function AccountNotFound() {
  const navigate = useNavigate();
  return (
    <PageContainer title="Submission not found">
      <EmptyState
        icon={<FileQuestion size={28} strokeWidth={1.5} />}
        title="This submission doesn't exist"
        description="It may have been on a different device, or the link is out of date."
        action={<Button onClick={() => navigate('/')}>Back to Dashboard</Button>}
      />
    </PageContainer>
  );
}
