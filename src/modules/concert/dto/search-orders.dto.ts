import { IsString, IsNotEmpty } from "class-validator";

export class SearchOrdersDto {
  @IsString()
  @IsNotEmpty()
  q: string;
}
