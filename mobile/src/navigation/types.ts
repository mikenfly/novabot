export type RootStackParamList = {
  Login: undefined;
  App: undefined;
};

export type AppStackParamList = {
  ConversationList: undefined;
  Chat: { conversationId: string; conversationName: string };
  Settings: undefined;
};
