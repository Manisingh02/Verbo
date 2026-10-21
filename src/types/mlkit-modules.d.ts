declare module '@infinitered/react-native-mlkit-text-recognition' {
  export type Rect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };

  export type TextLine = {
    text: string;
    frame: Rect;
  };

  export type TextBlock = {
    text?: string;
    frame: Rect;
    lines: TextLine[];
  };

  export type Text = {
    text?: string;
    blocks: TextBlock[];
  };

  export function recognizeText(uri: string): Promise<Text>;
}

declare module '@infinitered/react-native-mlkit-object-detection' {
  export type RNMLKitRect = {
    origin: {
      x: number;
      y: number;
    };
    size: {
      x: number;
      y: number;
    };
  };

  export type RNMLKitObjectDetectionLabel = {
    text: string;
    confidence?: number;
  };

  export type RNMLKitObjectDetectionObject = {
    frame: RNMLKitRect;
    labels: RNMLKitObjectDetectionLabel[];
  };

  export const ObjectDetectionContext: any;

  export function useObjectDetection<T = unknown>(
    modelName?: string
  ): {
    detectObjects(uri: string): Promise<RNMLKitObjectDetectionObject[]>;
  } | null;

  export function useObjectDetectionModels(options?: unknown): unknown;
}
