// questions.ts

export type Question = {
  timestamp: number;
  question: string;
  choices: string[];
  answerIndex: number;
};

export const fetchQuestionsForVideo = async (youtubeUrl: string): Promise<Question[]> => {
  //  FUTURE FETCH LOGIC 

  return [
    { timestamp: 3, question: "Are we winning a prize?", choices: ["yes", "no", "maybe"], answerIndex: 0 },
    { timestamp: 6, question: "What is 2 + 2?", choices: ["3", "4", "5"], answerIndex: 1 },
  ];
};
