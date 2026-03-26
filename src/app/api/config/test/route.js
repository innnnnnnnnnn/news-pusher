import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';

export async function POST(req) {
  try {
    const { telegramToken, chatId } = await req.json();
    
    if (!telegramToken || !chatId) {
      return NextResponse.json({ error: 'Token and Chat ID are required' }, { status: 400 });
    }

    const bot = new TelegramBot(telegramToken, { polling: false });
    
    // Attempt to send a test message
    await bot.sendMessage(chatId, '🔔 *News Pusher 測試成功!*\n您的 Telegram 機器人已成功連線。🚀', { parse_mode: 'Markdown' });
    
    return NextResponse.json({ success: true, message: 'Test message sent!' });
  } catch (error) {
    console.error('Telegram Test error:', error);
    return NextResponse.json({ error: error.message || 'Failed to send message. Please check token or Chat ID.' }, { status: 500 });
  }
}
