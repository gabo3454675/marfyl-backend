import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsString()
  @MaxLength(8000)
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content: string;
}

export class AssistantChatDto {
  @IsString()
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  context?: string;
}
