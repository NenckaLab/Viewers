import React from 'react';
import { StudyBrowser } from '@ohif/ui-next';

interface XNATStudyBrowserProps {
  studies: Array<{
    StudyInstanceUID: string;
    StudyDescription?: string;
    PatientName?: string;
    PatientID?: string;
    StudyDate?: string;
    thumbnails: Array<{
      displaySetInstanceUID: string;
      SeriesDescription: string;
      SeriesNumber: string | number;
      modality: string;
      numImageFrames: number;
      imageId?: string;
      imageSrc?: string;
    }>;
    session?: {
      experimentId: string;
      projectId: string;
      subjectId: string;
    };
  }>;
  onThumbnailClick: (displaySetInstanceUID: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onThumbnailDoubleClick: (displaySetInstanceUID: string) => void;
  supportsDrag?: boolean;
}

function formatSessionDate(value?: string): string {
  if (!value) {
    return '';
  }
  const digits = String(value).replace(/\D/g, '');
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return String(value);
}

function resolveStudyLabel(study: XNATStudyBrowserProps['studies'][number]): string {
  if (study.PatientName) {
    return study.PatientName;
  }
  if (study.session?.experimentId) {
    return study.session.experimentId;
  }
  return study.PatientID || '';
}

export default function XNATStudyBrowser({
  studies,
  onThumbnailClick,
  onThumbnailDoubleClick,
  supportsDrag = false,
}: XNATStudyBrowserProps) {
  if (!studies || studies.length === 0) {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden p-4">
        <div className="text-sm text-muted-foreground">No studies available</div>
      </div>
    );
  }

  const transformedData = {
    tabs: [
      {
        name: 'xnat-studies',
        label: 'XNAT Studies',
        studies: studies.map(study => ({
          studyInstanceUid: study.StudyInstanceUID,
          // Study row: patient, project, and session date. Modality stays off this header.
          date: resolveStudyLabel(study),
          description: study.session?.projectId || '',
          modalities: formatSessionDate(study.StudyDate),
          displaySets: study.thumbnails.map(thumb => ({
            displaySetInstanceUID: thumb.displaySetInstanceUID,
            imageSrc: thumb.imageSrc,
            imageAltText: thumb.SeriesDescription,
            seriesDate: '',
            seriesNumber: thumb.SeriesNumber,
            numInstances: thumb.numImageFrames,
            description: thumb.SeriesDescription,
            componentType: 'thumbnail' as const,
            isTracked: false,
            dragData: supportsDrag
              ? {
                  type: 'displayset',
                  displaySetInstanceUID: thumb.displaySetInstanceUID,
                }
              : undefined,
          })),
        })),
      },
    ],
    activeTabName: 'xnat-studies',
    expandedStudyInstanceUIDs: studies.map(s => s.StudyInstanceUID),
    activeDisplaySetInstanceUIDs: [],
    showSettings: false,
    servicesManager: null,
  };

  return (
    <div className="h-full">
      <StudyBrowser
        {...transformedData}
        onClickStudy={() => {}}
        onClickTab={() => {}}
        onClickThumbnail={onThumbnailClick}
        onDoubleClickThumbnail={onThumbnailDoubleClick}
        onClickUntrack={() => {}}
      />
    </div>
  );
}
