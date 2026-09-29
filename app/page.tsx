import { AniverseExperience } from '@/components/AniverseExperience';
import { catalog } from '@/lib/catalog';

export default function HomePage() {
  return <AniverseExperience items={catalog} />;
}
