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

function resolveStudyLabel(study: XNATStudyBrowserProps['studies'][number]): string {
  if (study.PatientName) {
    return study.PatientName;
  }
  if (study.session?.experimentId) {
    return study.session.experimentId;
  }
  if (study.StudyDate) {
    return study.StudyDate;
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
          // StudyBrowser primary line is `date` — show DICOM patient name when available.
          date: resolveStudyLabel(study),
          description: study.StudyDescription || study.StudyDate || '',
          numInstances: study.thumbnails.reduce(
            (total, thumb) => total + (thumb.numImageFrames || 0),
            0
          ),
          modalities: study.thumbnails
            .map(thumb => thumb.modality)
            .filter(Boolean)
            .join(', '),
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
